/**
 * Authentication middleware.
 *
 * Establishes *who* the caller is and attaches a typed `req.auth`. It makes no
 * authorization decisions beyond "is this a live session for a usable account"
 * — that is `authorize.ts`'s job.
 *
 * Each request costs one indexed user lookup plus, when session checking is on,
 * one refresh-token existence check. Both are deliberate: verifying the JWT
 * signature alone would be faster, but it would also mean a suspended user keeps
 * full access until their token expires, and a user whose role was just changed
 * keeps their old permissions. For an app where an admin suspending an account
 * expects that to mean *now*, two indexed reads is the right price.
 */

import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  ROLE_PERMISSIONS,
  Role,
  UserStatus,
  type Permission,
} from '@pawsitive/shared';
import { ApiError } from '../utils/api-error.js';
import { Doctor } from '../models/doctor.model.js';
import { User } from '../models/user.model.js';
import { isSessionActive, verifyAccessToken } from '../services/token.service.js';
import { asyncHandler } from '../utils/async-handler.js';

/* Permission sets are immutable per role, so build them once at module load
   rather than on every request. */
const PERMISSION_SETS = new Map<Role, ReadonlySet<Permission>>(
  (Object.keys(ROLE_PERMISSIONS) as Role[]).map((role) => [
    role,
    new Set(ROLE_PERMISSIONS[role]),
  ]),
);

/**
 * Require a valid session.
 *
 * Everything past this point can rely on `req.auth` being present.
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = extractBearerToken(req);

  if (!token) {
    throw ApiError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }

  /* Throws on a bad signature, wrong issuer/audience, or expiry. The error
     handler turns those into clean 401s with distinct codes, so the client can
     tell "refresh me" from "sign in again". */
  const claims = verifyAccessToken(token);

  if (!Types.ObjectId.isValid(claims.sub)) {
    throw ApiError.unauthorized(ERROR_CODES.TOKEN_INVALID);
  }

  /**
   * Session check.
   *
   * Closes the window in which a signed-out, suspended or compromised session
   * would keep working until its JWT naturally expired.
   */
  if (!(await isSessionActive(claims.sid))) {
    throw ApiError.unauthorized(ERROR_CODES.SESSION_REVOKED);
  }

  const user = await User.findById(claims.sub);

  if (!user) {
    /* The account was deleted after the token was issued. */
    throw ApiError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }

  assertAccountUsable(user.status, user.suspendedReason);

  /**
   * Read the role from the *database*, not from the token.
   *
   * A JWT is a snapshot of the moment it was signed. If an admin demotes a user
   * mid-session, trusting the token's `role` claim would leave the old, higher
   * privileges live until it expired. The claim is still useful as a cheap
   * pre-check, but the database is the authority.
   */
  const role = user.role;

  /* A doctor's own records are keyed by their Doctor profile, not their User
     id, so resolve it once here rather than in every doctor-scoped service. */
  let doctorId: Types.ObjectId | null = null;
  if (role === Role.DOCTOR) {
    const profile = await Doctor.findOne({ user: user._id }).select('_id').lean();
    doctorId = profile?._id ?? null;
  }

  req.auth = {
    userId: user._id,
    role,
    clinicId: user.clinic ?? null,
    doctorId,
    sessionId: claims.sid,
    permissions: PERMISSION_SETS.get(role) ?? new Set<Permission>(),
    impersonatorId:
      claims.imp && Types.ObjectId.isValid(claims.imp) ? new Types.ObjectId(claims.imp) : null,
  };

  req.currentUser = user;

  next();
});

/**
 * Attach `req.auth` when a token is present, but do not require one.
 *
 * For endpoints that are public yet richer when signed in — a doctor's profile
 * shows their reviews to everyone, and adds a "book again" affordance for a
 * returning client. A bad token is ignored rather than rejected: this route
 * works fine anonymously, so a stale token should degrade to anonymous rather
 * than break the page.
 */
export const optionalAuthenticate = asyncHandler(
  async (req: Request, res: Response, next: NextFunction) => {
    if (!extractBearerToken(req)) {
      next();
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        void authenticate(req, res, (error?: unknown) => (error ? reject(error) : resolve()));
      });
    } catch {
      /* Deliberately swallowed — see the note above. */
      delete req.auth;
      delete req.currentUser;
    }

    next();
  },
);

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function extractBearerToken(req: Request): string | null {
  const header = req.get('authorization');

  if (!header) return null;

  const [scheme, value] = header.split(' ');

  /* Case-insensitive: some clients send `bearer`. */
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;

  return value.trim() || null;
}

/**
 * Reject accounts that exist but may not hold a session.
 *
 * Each state gets its own code so the client can say something useful — a
 * suspended user needs to contact their clinic, an invited one needs to finish
 * setting up, and telling both "please sign in" helps neither.
 */
function assertAccountUsable(status: string, suspendedReason?: string | null): void {
  if (status === UserStatus.ACTIVE) return;

  if (status === UserStatus.SUSPENDED) {
    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.ACCOUNT_SUSPENDED,
      ...(suspendedReason ? { message: `This account has been suspended: ${suspendedReason}` } : {}),
    });
  }

  if (status === UserStatus.INVITED) {
    throw ApiError.unauthorized(
      ERROR_CODES.ACCOUNT_NOT_VERIFIED,
      'Please finish setting up your account using the link in your invitation email.',
    );
  }

  /* Deactivated, or anything added later. Generic on purpose. */
  throw ApiError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
}
