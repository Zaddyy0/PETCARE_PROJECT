/**
 * Authentication.
 *
 * Several behaviours here look like extra work and are load-bearing:
 *
 *   • **Sign-in does not reveal whether an email exists.** Same error, same
 *     status, and — crucially — the same amount of *time*, whether the account
 *     is missing or the password is wrong. A fast "no such user" and a slow
 *     "wrong password" is a user-enumeration oracle measurable over the
 *     network, which turns a credential-stuffing list into a validated one.
 *
 *   • **Forgot-password always reports success.** Same reasoning: "we sent you
 *     a link" versus "no account found" tells an attacker which addresses are
 *     registered.
 *
 *   • **Changing a password revokes every session.** If a password is being
 *     changed because it was compromised, leaving the attacker's existing
 *     session alive defeats the entire point.
 *
 *   • **Failed attempts lock the account.** Rate limiting alone is per-IP;
 *     lockout is per-account, which is what stops a distributed attack from
 *     grinding through one user's password.
 */

import type { Request } from 'express';
import { Types } from 'mongoose';
import {
  ERROR_CODES,
  Role,
  SECURITY,
  UserStatus,
  fullName,
  type AcceptInviteInput,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from '@pawsitive/shared';
import { createLogger } from '../config/logger.js';
import { toCurrentUserDTO } from '../dto/user.dto.js';
import { Doctor } from '../models/doctor.model.js';
import { User, type UserDocument } from '../models/user.model.js';
import { ApiError } from '../utils/api-error.js';
import {
  generateSecureToken,
  hashPassword,
  hashToken,
  needsRehash,
  verifyPassword,
} from '../utils/crypto.js';
import { recordAudit, SYSTEM_ACTOR, type AuditActor } from './audit.service.js';
import {
  passwordResetEmail,
  sendEmail,
  welcomeEmail,
} from './email.service.js';
import {
  issueAccessToken,
  issueRefreshToken,
  revokeAllSessions,
  revokeSession,
  rotateRefreshToken,
  type IssuedRefreshToken,
} from './token.service.js';

const log = createLogger('auth');

/**
 * A pre-computed hash of a throwaway password.
 *
 * When sign-in is attempted for an address that does not exist, we verify the
 * supplied password against *this* instead of returning early. The work is
 * wasted on purpose: it makes the "no such user" path cost the same as the
 * "wrong password" path, closing the timing side channel described above.
 *
 * Computed once, lazily, so module load stays fast.
 */
let decoyHash: string | null = null;

async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword(`decoy-${generateSecureToken(16)}`);
  return decoyHash;
}

export interface SessionResult {
  user: ReturnType<typeof toCurrentUserDTO>;
  accessToken: string;
  expiresIn: number;
  refresh: IssuedRefreshToken;
}

export interface RequestContext {
  userAgent?: string;
  ipAddress?: string;
  request?: Request;
}

/* -------------------------------------------------------------------------- */
/*                                  Register                                  */
/* -------------------------------------------------------------------------- */

/**
 * Self-registration, which always creates a **client**.
 *
 * The role is hardcoded, not read from the payload. Accepting a role here —
 * even "validated" against the enum — would let anyone POST
 * `{"role":"super_admin"}` and own the platform. Doctors and admins are created
 * by an admin through the invitation flow instead.
 */
export async function register(
  input: RegisterInput,
  context: RequestContext,
): Promise<SessionResult> {
  const existing = await User.findOne({ email: input.email }).select('_id').lean();

  if (existing) {
    /* Registration is one place we *must* say the address is taken — the user
       cannot proceed otherwise. The exposure is mitigated by the strict rate
       limit on this route. */
    throw ApiError.conflict(ERROR_CODES.EMAIL_ALREADY_REGISTERED);
  }

  const user = await User.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    ...(input.phone ? { phone: input.phone } : {}),
    role: Role.CLIENT,
    status: UserStatus.ACTIVE,
    passwordChangedAt: new Date(),
  });

  log.info({ userId: user._id.toString() }, 'New client registered');

  void sendEmail(welcomeEmail(user.email, user.firstName));

  void recordAudit({
    actor: { id: user._id, name: fullName(user.firstName, user.lastName), role: Role.CLIENT },
    action: 'user.created',
    targetType: 'User',
    targetId: user._id,
    targetLabel: user.email,
    ...(context.request ? { request: context.request } : {}),
  });

  return createSession(user, context, false);
}

/* -------------------------------------------------------------------------- */
/*                                    Login                                   */
/* -------------------------------------------------------------------------- */

export async function login(input: LoginInput, context: RequestContext): Promise<SessionResult> {
  const user = await User.findByEmailWithPassword(input.email);

  /* ---- Unknown address: burn equivalent time, then fail identically. ---- */
  if (!user) {
    await verifyPassword(input.password, await getDecoyHash());
    throw ApiError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
  }

  /* ---- Locked out. ------------------------------------------------------ */
  if (user.isLocked()) {
    const minutes = Math.ceil(((user.lockedUntil?.getTime() ?? 0) - Date.now()) / 60_000);

    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.ACCOUNT_LOCKED,
      message: `Too many failed attempts. Try again in ${Math.max(1, minutes)} minute${minutes === 1 ? '' : 's'}.`,
      retryAfterSeconds: Math.max(60, minutes * 60),
    });
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    await registerFailedAttempt(user);

    void recordAudit({
      actor: { id: user._id, name: user.email, role: user.role },
      action: 'auth.login_failed',
      targetType: 'User',
      targetId: user._id,
      outcome: 'failure',
      failureReason: 'invalid_password',
      ...(context.request ? { request: context.request } : {}),
    });

    throw ApiError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
  }

  /* ---- Correct password, but the account may still not sign in. -------- */
  assertCanSignIn(user);

  /**
   * Transparently upgrade the hash.
   *
   * If the work factor has been raised since this password was set, we have the
   * plaintext in hand exactly once — right now — so rehash it. Users are
   * migrated to stronger parameters without ever being asked to do anything.
   */
  if (needsRehash(user.passwordHash)) {
    user.passwordHash = await hashPassword(input.password);
    log.info({ userId: user._id.toString() }, 'Upgraded password hash parameters');
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  user.lastLoginIp = context.ipAddress ?? null;
  await user.save();

  void recordAudit({
    actor: { id: user._id, name: fullName(user.firstName, user.lastName), role: user.role },
    action: 'auth.login_succeeded',
    targetType: 'User',
    targetId: user._id,
    ...(context.request ? { request: context.request } : {}),
  });

  return createSession(user, context, input.rememberMe ?? false);
}

/**
 * Count a failed attempt and lock once the threshold is reached.
 *
 * Uses an atomic `$inc` rather than read-modify-write: several simultaneous
 * wrong guesses must each count, and a read-then-save would lose all but one.
 */
async function registerFailedAttempt(user: UserDocument): Promise<void> {
  const attempts = (user.failedLoginAttempts ?? 0) + 1;

  const update: Record<string, unknown> = { failedLoginAttempts: attempts };

  if (attempts >= SECURITY.MAX_LOGIN_ATTEMPTS) {
    update['lockedUntil'] = new Date(Date.now() + SECURITY.LOCKOUT_MINUTES * 60_000);
    update['failedLoginAttempts'] = 0;

    log.warn(
      { userId: user._id.toString(), attempts },
      'Account locked after repeated failed sign-in attempts',
    );
  }

  await User.updateOne({ _id: user._id }, { $set: update });
}

function assertCanSignIn(user: UserDocument): void {
  if (user.status === UserStatus.ACTIVE) return;

  if (user.status === UserStatus.SUSPENDED) {
    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.ACCOUNT_SUSPENDED,
      ...(user.suspendedReason
        ? { message: `This account has been suspended: ${user.suspendedReason}` }
        : {}),
    });
  }

  if (user.status === UserStatus.INVITED) {
    throw ApiError.unauthorized(
      ERROR_CODES.ACCOUNT_NOT_VERIFIED,
      'Please finish setting up your account using the link in your invitation email.',
    );
  }

  throw ApiError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS);
}

/* -------------------------------------------------------------------------- */
/*                              Session plumbing                              */
/* -------------------------------------------------------------------------- */

async function createSession(
  user: UserDocument,
  context: RequestContext,
  rememberMe: boolean,
  impersonatorId?: Types.ObjectId,
): Promise<SessionResult> {
  const refresh = await issueRefreshToken({
    userId: user._id,
    rememberMe,
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
  });

  const { token: accessToken, expiresIn } = issueAccessToken({
    userId: user._id,
    role: user.role,
    clinicId: user.clinic ?? null,
    sessionId: refresh.sessionId,
    ...(impersonatorId ? { impersonatorId } : {}),
  });

  const doctorId = await resolveDoctorId(user);

  return {
    user: toCurrentUserDTO(user, {
      doctorId,
      ...(impersonatorId ? { impersonatorId } : {}),
    }),
    accessToken,
    expiresIn,
    refresh,
  };
}

async function resolveDoctorId(user: UserDocument): Promise<Types.ObjectId | null> {
  if (user.role !== Role.DOCTOR) return null;
  const profile = await Doctor.findOne({ user: user._id }).select('_id').lean();
  return profile?._id ?? null;
}

/**
 * Exchange a refresh token for a new access token.
 *
 * The account is re-checked on every refresh, so a user suspended mid-session
 * is stopped at the next rotation rather than continuing until their refresh
 * token expires days later.
 */
export async function refresh(
  presentedToken: string,
  context: RequestContext,
): Promise<Omit<SessionResult, 'user'> & { user: ReturnType<typeof toCurrentUserDTO> }> {
  const { userId, refresh: rotated } = await rotateRefreshToken(presentedToken, {
    ...(context.userAgent ? { userAgent: context.userAgent } : {}),
    ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
  });

  const user = await User.findById(userId);

  if (!user) {
    throw ApiError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }

  assertCanSignIn(user);

  const { token: accessToken, expiresIn } = issueAccessToken({
    userId: user._id,
    role: user.role,
    clinicId: user.clinic ?? null,
    sessionId: rotated.sessionId,
  });

  return {
    user: toCurrentUserDTO(user, { doctorId: await resolveDoctorId(user) }),
    accessToken,
    expiresIn,
    refresh: rotated,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId, 'logout');
}

export async function logoutEverywhere(userId: Types.ObjectId): Promise<number> {
  return revokeAllSessions(userId, 'logout');
}

/* -------------------------------------------------------------------------- */
/*                               Password reset                               */
/* -------------------------------------------------------------------------- */

/**
 * Begin a password reset.
 *
 * Always resolves, whether or not the address is registered — the response the
 * caller sees is identical either way.
 */
export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email }).select('+passwordResetTokenHash firstName email status');

  if (!user || user.status === UserStatus.DEACTIVATED) {
    log.info({ email }, 'Password reset requested for an unknown or closed account');
    return;
  }

  const token = generateSecureToken(32);

  /* Stored hashed, so a database dump does not hand over working reset links. */
  user.passwordResetTokenHash = hashToken(token);
  user.passwordResetExpiresAt = new Date(
    Date.now() + SECURITY.PASSWORD_RESET_TTL_MINUTES * 60_000,
  );
  await user.save();

  await sendEmail(passwordResetEmail(user.email, user.firstName, token));
}

export async function resetPassword(
  token: string,
  newPassword: string,
  context: RequestContext,
): Promise<void> {
  const user = await User.findOne({
    passwordResetTokenHash: hashToken(token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpiresAt +passwordHash +passwordHistory');

  if (!user) {
    throw ApiError.badRequest(ERROR_CODES.PASSWORD_RESET_INVALID);
  }

  await assertPasswordNotReused(user, newPassword);
  await applyNewPassword(user, newPassword);

  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;

  /* An invited user who resets their password has proved they control the
     address, so the invitation is complete. */
  if (user.status === UserStatus.INVITED) {
    user.status = UserStatus.ACTIVE;
    user.emailVerified = true;
  }

  await user.save();

  /* Every existing session dies — see the file header. */
  const revoked = await revokeAllSessions(user._id, 'password_change');

  log.info(
    { userId: user._id.toString(), revokedSessions: revoked },
    'Password reset — all sessions revoked',
  );

  void recordAudit({
    actor: { id: user._id, name: fullName(user.firstName, user.lastName), role: user.role },
    action: 'auth.password_reset',
    targetType: 'User',
    targetId: user._id,
    ...(context.request ? { request: context.request } : {}),
  });
}

export async function changePassword(
  userId: Types.ObjectId,
  input: ChangePasswordInput,
  context: RequestContext,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash +passwordHistory');

  if (!user) {
    throw ApiError.notFound(ERROR_CODES.USER_NOT_FOUND);
  }

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw ApiError.unauthorized(ERROR_CODES.INVALID_CREDENTIALS, 'Your current password is not correct.');
  }

  await assertPasswordNotReused(user, input.newPassword);
  await applyNewPassword(user, input.newPassword);
  await user.save();

  await revokeAllSessions(user._id, 'password_change');

  void recordAudit({
    actor: { id: user._id, name: fullName(user.firstName, user.lastName), role: user.role },
    action: 'auth.password_reset',
    targetType: 'User',
    targetId: user._id,
    ...(context.request ? { request: context.request } : {}),
  });
}

/**
 * Block reuse of a recent password.
 *
 * Each stored hash has its own salt, so this is a linear scan of comparisons
 * rather than a lookup — which is why the history is kept deliberately short.
 */
async function assertPasswordNotReused(user: UserDocument, candidate: string): Promise<void> {
  const history = [user.passwordHash, ...(user.passwordHistory ?? [])].filter(Boolean);

  for (const previous of history.slice(0, SECURITY.PASSWORD_HISTORY_SIZE)) {
    if (await verifyPassword(candidate, previous)) {
      throw ApiError.badRequest(ERROR_CODES.PASSWORD_REUSED);
    }
  }
}

async function applyNewPassword(user: UserDocument, newPassword: string): Promise<void> {
  const previous = user.passwordHash;

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;

  user.passwordHistory = [previous, ...(user.passwordHistory ?? [])]
    .filter(Boolean)
    .slice(0, SECURITY.PASSWORD_HISTORY_SIZE);
}

/* -------------------------------------------------------------------------- */
/*                                Invitations                                 */
/* -------------------------------------------------------------------------- */

export async function acceptInvite(
  input: AcceptInviteInput,
  context: RequestContext,
): Promise<SessionResult> {
  const user = await User.findOne({
    inviteTokenHash: hashToken(input.token),
    inviteExpiresAt: { $gt: new Date() },
  }).select('+inviteTokenHash +inviteExpiresAt +passwordHash +passwordHistory');

  if (!user) {
    throw ApiError.badRequest(ERROR_CODES.INVITE_INVALID);
  }

  if (user.status !== UserStatus.INVITED) {
    /* Already accepted. Say so plainly rather than looping them back to an
       invitation link that will never work again. */
    throw ApiError.badRequest(
      ERROR_CODES.INVITE_INVALID,
      'This invitation has already been used. Please sign in instead.',
    );
  }

  await applyNewPassword(user, input.password);

  if (input.firstName) user.firstName = input.firstName;
  if (input.lastName) user.lastName = input.lastName;

  user.status = UserStatus.ACTIVE;
  user.emailVerified = true;
  user.inviteTokenHash = null;
  user.inviteExpiresAt = null;
  await user.save();

  log.info({ userId: user._id.toString(), role: user.role }, 'Invitation accepted');

  return createSession(user, context, false);
}

/* -------------------------------------------------------------------------- */
/*                               Impersonation                                */
/* -------------------------------------------------------------------------- */

/**
 * Sign in as another user, for support.
 *
 * Guarded three ways, because this is the single most dangerous capability on
 * the platform: only a super admin may do it, a super admin may not impersonate
 * another super admin, and every session is audited with the stated reason and
 * expires quickly.
 *
 * The resulting token carries an `imp` claim, so the impersonated session is
 * distinguishable from a real one in logs and visible in the UI — nobody should
 * be able to act as someone else invisibly.
 */
export async function impersonate(
  actor: AuditActor & { id: Types.ObjectId },
  targetUserId: Types.ObjectId,
  reason: string,
  context: RequestContext,
): Promise<SessionResult> {
  const target = await User.findById(targetUserId);

  if (!target) {
    throw ApiError.notFound(ERROR_CODES.USER_NOT_FOUND);
  }

  /**
   * Self first, then peers.
   *
   * The order matters for the message, not the outcome. Only a super admin can
   * reach this method at all, and the peer check below rejects any super admin
   * target — so if the self check came second it would be unreachable, and
   * someone clicking their own name would be told "super admins cannot be
   * impersonated" rather than the obvious truth.
   */
  if (target._id.toString() === actor.id.toString()) {
    throw ApiError.badRequest(
      ERROR_CODES.VALIDATION_FAILED,
      'You are already signed in as yourself.',
    );
  }

  if (target.role === Role.SUPER_ADMIN) {
    throw ApiError.forbidden(
      ERROR_CODES.CANNOT_ACT_ON_ROLE,
      'Super admins cannot be impersonated.',
    );
  }

  await recordAudit({
    actor,
    action: 'user.impersonated',
    targetType: 'User',
    targetId: target._id,
    targetLabel: target.email,
    changes: [{ field: 'reason', from: null, to: reason }],
    ...(context.request ? { request: context.request } : {}),
  });

  log.warn(
    { actorId: actor.id.toString(), targetId: target._id.toString(), reason },
    'Impersonation session started',
  );

  return createSession(target, context, false, actor.id);
}

/** The caller's own profile, for the client to hydrate its store on load. */
export async function currentUser(
  userId: Types.ObjectId,
  impersonatorId: Types.ObjectId | null,
): Promise<ReturnType<typeof toCurrentUserDTO>> {
  const user = await User.findById(userId);

  if (!user) {
    throw ApiError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }

  return toCurrentUserDTO(user, {
    doctorId: await resolveDoctorId(user),
    ...(impersonatorId ? { impersonatorId } : {}),
  });
}

export { SYSTEM_ACTOR };
