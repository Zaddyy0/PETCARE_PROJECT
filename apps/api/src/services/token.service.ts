/**
 * Token issuance, verification and rotation.
 *
 * See `models/refresh-token.model.ts` for the reasoning behind the two-token
 * design. This module implements it:
 *
 *   • `issueAccessToken`  — a short-lived signed JWT, held in memory client-side
 *   • `issueRefreshToken` — a random opaque string, stored hashed, sent as an
 *                           httpOnly cookie
 *   • `rotateRefreshToken` — single-use exchange with **reuse detection**
 */

import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  SECURITY,
  type AccessTokenClaims,
  type Role,
} from '@pawsitive/shared';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { RefreshToken } from '../models/refresh-token.model.js';
import { ApiError } from '../utils/api-error.js';
import { generateSecureToken, generateSessionId, hashToken } from '../utils/crypto.js';

const log = createLogger('tokens');

export interface AccessTokenInput {
  userId: Types.ObjectId;
  role: Role;
  clinicId: Types.ObjectId | null;
  sessionId: string;
  impersonatorId?: Types.ObjectId | null;
}

export interface IssuedRefreshToken {
  /** The plaintext, returned once so it can be set as a cookie. Never stored. */
  token: string;
  sessionId: string;
  family: string;
  expiresAt: Date;
}

/* -------------------------------------------------------------------------- */
/*                                Access tokens                               */
/* -------------------------------------------------------------------------- */

/**
 * Sign a short-lived access token.
 *
 * The payload is intentionally minimal — it travels on every request, and
 * anything in it is readable by anyone holding the token (a JWT is signed, not
 * encrypted). Never put an email, a name or a permission list in here: the
 * permission set is derived from `role` server-side on each request, so a role
 * change takes effect within one token lifetime rather than whenever the user
 * happens to sign in again.
 */
export function issueAccessToken(input: AccessTokenInput): { token: string; expiresIn: number } {
  const expiresInSeconds = SECURITY.ACCESS_TOKEN_TTL_MINUTES * 60;

  const payload: Omit<AccessTokenClaims, 'iat' | 'exp'> = {
    sub: input.userId.toString(),
    role: input.role,
    clinicId: input.clinicId ? input.clinicId.toString() : null,
    sid: input.sessionId,
    ...(input.impersonatorId ? { imp: input.impersonatorId.toString() } : {}),
  };

  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: expiresInSeconds,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    /* Explicit, so a token forged with `alg: none` is rejected outright. */
    algorithm: 'HS256',
  });

  return { token, expiresIn: expiresInSeconds };
}

/**
 * Verify an access token.
 *
 * `algorithms` is pinned. Without it, `jsonwebtoken` would accept whatever the
 * token's own header claims — the classic algorithm-confusion attack, where a
 * token signed with `none` (or with the public key as an HMAC secret) verifies
 * successfully.
 */
export function verifyAccessToken(token: string): AccessTokenClaims {
  /* Throws `TokenExpiredError` / `JsonWebTokenError`, both translated to clean
     401s by the error handler. */
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithms: ['HS256'],
  }) as AccessTokenClaims;
}

/* -------------------------------------------------------------------------- */
/*                               Refresh tokens                               */
/* -------------------------------------------------------------------------- */

export interface IssueRefreshInput {
  userId: Types.ObjectId;
  /** Continues an existing family on rotation; omit to start a new session. */
  family?: string;
  sessionId?: string;
  rememberMe?: boolean;
  userAgent?: string;
  ipAddress?: string;
}

export async function issueRefreshToken(input: IssueRefreshInput): Promise<IssuedRefreshToken> {
  const token = generateSecureToken(32);
  const family = input.family ?? generateSecureToken(16);
  const sessionId = input.sessionId ?? generateSessionId();

  const ttlDays = input.rememberMe
    ? SECURITY.REFRESH_TOKEN_TTL_DAYS_REMEMBERED
    : SECURITY.REFRESH_TOKEN_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);

  await RefreshToken.create({
    user: input.userId,
    /* Only the hash is persisted. A database dump yields no usable tokens. */
    tokenHash: hashToken(token),
    family,
    sessionId,
    expiresAt,
    userAgent: input.userAgent?.slice(0, 300),
    ipAddress: input.ipAddress?.slice(0, 64),
  });

  return { token, sessionId, family, expiresAt };
}

export interface RotationResult {
  userId: Types.ObjectId;
  refresh: IssuedRefreshToken;
}

/**
 * Exchange a refresh token for a fresh one.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  REUSE DETECTION
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Each refresh token is single-use. When one is presented a second time, one of
 * two things has happened:
 *
 *   a) the legitimate client retried after a dropped response, or
 *   b) an attacker is replaying a stolen token.
 *
 * We cannot distinguish them, and the cost of guessing wrong is asymmetric: a
 * false positive is one extra sign-in, a false negative is indefinite silent
 * account access. So we assume the worst and revoke the **entire family** —
 * every token descended from that sign-in, including whichever one the attacker
 * would use next.
 *
 * This is why `family` exists. Revoking just the replayed token would leave the
 * attacker's freshly-rotated successor perfectly valid.
 */
export async function rotateRefreshToken(
  presentedToken: string,
  context: { userAgent?: string; ipAddress?: string },
): Promise<RotationResult> {
  const tokenHash = hashToken(presentedToken);
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing) {
    throw ApiError.unauthorized(ERROR_CODES.TOKEN_INVALID);
  }

  /* ---- Already spent or revoked: treat as compromise. ------------------- */
  if (existing.rotatedAt || existing.revokedAt) {
    log.warn(
      {
        userId: existing.user.toString(),
        family: existing.family,
        reason: existing.revokedAt ? 'revoked' : 'already_rotated',
      },
      'Refresh token reuse detected — revoking the whole token family',
    );

    await RefreshToken.updateMany(
      { family: existing.family, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'reuse_detected' } },
    );

    throw ApiError.unauthorized(ERROR_CODES.REFRESH_TOKEN_REUSED);
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized(ERROR_CODES.TOKEN_EXPIRED);
  }

  /* ---- Good token: issue the successor and retire this one. ------------- */
  const next = await issueRefreshToken({
    userId: existing.user,
    /* Same family and session: this is a continuation, not a new sign-in. */
    family: existing.family,
    sessionId: existing.sessionId,
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
  });

  existing.rotatedAt = new Date();
  existing.replacedBy = hashToken(next.token);
  existing.revokedReason = 'rotation';
  await existing.save();

  return { userId: existing.user, refresh: next };
}

/** Revoke a single session — one device signing out. */
export async function revokeSession(sessionId: string, reason: IRevokeReason): Promise<void> {
  await RefreshToken.updateMany(
    { sessionId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

/** Revoke every session for a user — "sign out everywhere", or a password change. */
export async function revokeAllSessions(
  userId: Types.ObjectId,
  reason: IRevokeReason,
): Promise<number> {
  const result = await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );

  return result.modifiedCount;
}

export type IRevokeReason = 'logout' | 'rotation' | 'reuse_detected' | 'admin' | 'password_change';

/**
 * Is the session behind an access token still live?
 *
 * A JWT is valid until it expires, full stop — the server cannot un-sign it.
 * That is normally fine for a 15-minute token, but it means a suspended or
 * signed-out user keeps working for up to 15 more minutes. Checking the session
 * on each request closes that window at the cost of one indexed lookup, which
 * is the right trade for an app where an admin suspending an account expects it
 * to take effect now.
 */
export async function isSessionActive(sessionId: string): Promise<boolean> {
  const live = await RefreshToken.exists({
    sessionId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });

  return live !== null;
}

/** Cookie options for the refresh token. */
export function refreshCookieOptions(expiresAt: Date) {
  return {
    /* Unreadable from JavaScript — this is the whole point. */
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    /**
     * `lax` lets the cookie ride on top-level navigations (a user following an
     * email link lands signed in) while still blocking it on cross-site
     * subrequests, which is the CSRF vector that matters.
     */
    sameSite: 'lax' as const,
    /* Scoped to the refresh route, so it is not sent on every API call. */
    path: '/api/v1/auth',
    expires: expiresAt,
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export const REFRESH_COOKIE_NAME = 'pawsitive_rt';
