/**
 * User administration.
 *
 * This is where privilege escalation would live if it were possible, so the
 * guards are explicit and repeated:
 *
 *   • An actor may only act on someone of *strictly lower* rank, so two admins
 *     cannot suspend each other and neither can touch a super admin.
 *   • An actor may only *grant* a role below their own, so "admin can edit
 *     users" cannot quietly mean "admin can make themselves super admin".
 *   • The last super admin cannot be demoted or deactivated, or the platform
 *     locks itself out permanently.
 */

import { Types } from 'mongoose';
import {
  ERROR_CODES,
  Role,
  SECURITY,
  UserStatus,
  fullName,
  type CreateUserInput,
  type UpdateProfileInput,
  type UpdateUserInput,
  type UserListQueryInput,
} from '@pawsitive/shared';
import { toClinicDTO, toUserDTO } from '../dto/user.dto.js';
import { Clinic } from '../models/clinic.model.js';
import { Doctor } from '../models/doctor.model.js';
import { Pet } from '../models/pet.model.js';
import { User, type UserDocument } from '../models/user.model.js';
import { ApiError } from '../utils/api-error.js';
import { generateSecureToken, hashPassword, hashToken } from '../utils/crypto.js';
import {
  buildPaginationMeta,
  buildSearchFilter,
  buildSort,
  resolvePage,
} from '../utils/pagination.js';
import type { AuthContext } from '../types/express.js';
import { assertCanActOnUser, assertCanAssignRole } from '../middleware/authorize.js';
import { recordAudit, diffFields, type AuditActor } from './audit.service.js';
import { accountSuspendedEmail, inviteEmail, sendEmail } from './email.service.js';
import { revokeAllSessions } from './token.service.js';
import { toObjectId } from './scope.js';

const SORTABLE = ['createdAt', 'lastLoginAt', 'firstName'] as const;

/* -------------------------------------------------------------------------- */
/*                                    List                                    */
/* -------------------------------------------------------------------------- */

export async function listUsers(auth: AuthContext, query: UserListQueryInput) {
  const { page, limit, skip } = resolvePage(query);
  const filter: Record<string, unknown> = {};

  /* An admin sees their clinic's staff plus every client — clients are not
     clinic-scoped, so a clinic filter alone would hide the people an admin
     most needs to manage. */
  if (auth.role !== Role.SUPER_ADMIN) {
    if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);

    filter['$or'] = [{ clinic: auth.clinicId }, { role: Role.CLIENT }];
  } else if (query.clinicId) {
    filter['clinic'] = toObjectId(query.clinicId, 'clinicId');
  }

  if (query.role) filter['role'] = query.role;
  if (query.status) filter['status'] = query.status;

  const search = buildSearchFilter(query.search, ['firstName', 'lastName', 'email']);

  if (search) {
    /* Merge carefully: an existing `$or` from the scope filter must not be
       overwritten by the search's `$or`, or the scope silently disappears and
       the search returns the whole platform. */
    const existingOr = filter['$or'];
    delete filter['$or'];
    filter['$and'] = existingOr ? [{ $or: existingOr }, search] : [search];
  }

  const sort = buildSort(query.sort, query.order, SORTABLE, 'createdAt');

  const [users, total] = await Promise.all([
    User.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);

  /* Attach doctor profile ids in one query rather than per row. */
  const doctorUserIds = users.filter((user) => user.role === Role.DOCTOR).map((user) => user._id);

  const profiles =
    doctorUserIds.length > 0
      ? await Doctor.find({ user: { $in: doctorUserIds } }).select('user').lean()
      : [];

  const profileByUser = new Map(
    profiles.map((profile) => [profile.user.toString(), profile._id]),
  );

  const items = users.map((user) => toUserDTO(user, profileByUser.get(user._id.toString())));

  return { items, pagination: buildPaginationMeta(total, { page, limit }) };
}

export async function getUser(auth: AuthContext, userId: string) {
  const user = await loadUserInScope(auth, userId);

  const profile =
    user.role === Role.DOCTOR
      ? await Doctor.findOne({ user: user._id }).select('_id').lean()
      : null;

  const dto = toUserDTO(user, profile?._id);

  /* A little extra context the admin console shows alongside the profile. */
  const petCount = user.role === Role.CLIENT ? await Pet.countDocuments({ owner: user._id }) : 0;

  return { ...dto, petCount };
}

/* -------------------------------------------------------------------------- */
/*                                   Create                                   */
/* -------------------------------------------------------------------------- */

export async function createUser(auth: AuthContext, input: CreateUserInput, actor: AuditActor) {
  /* Cannot create someone at or above your own rank. */
  assertCanAssignRole(auth.role, input.role);

  /* A doctor account must go through `createDoctor`, which also builds the
     profile — creating a bare doctor user here would leave an account that can
     sign in but has no bookable identity. */
  if (input.role === Role.DOCTOR) {
    throw ApiError.badRequest(
      ERROR_CODES.VALIDATION_FAILED,
      'Create veterinarians through the doctors endpoint so their profile is set up too.',
    );
  }

  const existing = await User.findOne({ email: input.email }).select('_id').lean();
  if (existing) {
    throw ApiError.conflict(ERROR_CODES.EMAIL_ALREADY_REGISTERED);
  }

  const clinicId = resolveClinic(auth, input);

  if (clinicId) {
    const clinic = await Clinic.findById(clinicId).select('_id').lean();
    if (!clinic) {
      throw ApiError.validation([{ field: 'clinicId', message: 'That clinic does not exist' }]);
    }
  }

  const inviteToken = input.sendInvite ? generateSecureToken(32) : null;

  const user = await User.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    ...(input.phone ? { phone: input.phone } : {}),
    role: input.role,
    ...(clinicId ? { clinic: clinicId } : {}),
    status: input.sendInvite ? UserStatus.INVITED : UserStatus.ACTIVE,
    /* Even without an invite, the stored hash is of a random string unless a
       password was supplied — never a predictable default. */
    passwordHash: await hashPassword(input.password ?? generateSecureToken(24)),
    invitedBy: auth.userId,
    ...(inviteToken
      ? {
          inviteTokenHash: hashToken(inviteToken),
          inviteExpiresAt: new Date(Date.now() + SECURITY.INVITE_TTL_DAYS * 86_400_000),
        }
      : {}),
  });

  if (clinicId && input.role !== Role.CLIENT) {
    await Clinic.updateOne({ _id: clinicId }, { $inc: { 'stats.clientCount': 0 } });
  }

  void recordAudit({
    actor,
    action: 'user.created',
    targetType: 'User',
    targetId: user._id,
    targetLabel: user.email,
    changes: [{ field: 'role', from: null, to: input.role }],
  });

  if (inviteToken) {
    const inviter = await User.findById(auth.userId).select('firstName lastName').lean();

    void sendEmail(
      inviteEmail(
        user.email,
        user.firstName,
        inviteToken,
        inviter ? fullName(inviter.firstName, inviter.lastName) : 'Your clinic',
        input.role.replace('_', ' '),
      ),
    );
  }

  return toUserDTO(user);
}

function resolveClinic(auth: AuthContext, input: CreateUserInput): Types.ObjectId | null {
  /* Clients are never clinic-scoped. */
  if (input.role === Role.CLIENT) return null;

  if (auth.role === Role.SUPER_ADMIN) {
    return input.clinicId ? toObjectId(input.clinicId, 'clinicId') : null;
  }

  /* An admin's own clinic, regardless of what they asked for. */
  if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
  return auth.clinicId;
}

/* -------------------------------------------------------------------------- */
/*                                   Update                                   */
/* -------------------------------------------------------------------------- */

/** Self-service profile edit. Cannot touch role, status or clinic. */
export async function updateOwnProfile(auth: AuthContext, input: UpdateProfileInput) {
  const user = await User.findById(auth.userId);

  if (!user) throw ApiError.notFound(ERROR_CODES.USER_NOT_FOUND);

  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.phone !== undefined) {
    user.phone = input.phone;
    /* A changed number is unverified again — otherwise the verified flag would
       vouch for a number nobody has checked. */
    user.phoneVerified = false;
  }
  if (input.address !== undefined) user.address = input.address;
  if (input.locale !== undefined) user.locale = input.locale;
  if (input.timezone !== undefined) user.timezone = input.timezone;

  if (input.notificationPreferences) {
    user.notificationPreferences = {
      ...user.notificationPreferences,
      ...input.notificationPreferences,
    };
  }

  await user.save();
  return toUserDTO(user);
}

export async function updateUser(
  auth: AuthContext,
  userId: string,
  input: UpdateUserInput,
  actor: AuditActor,
) {
  const user = await loadUserInScope(auth, userId);

  /* Rank guard: cannot edit a peer or a superior. */
  assertCanActOnUser(auth.role, user.role);

  const before = {
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    clinic: user.clinic,
    status: user.status,
  };

  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.address !== undefined) user.address = input.address;

  /* Only a super admin may move someone between clinics — for an admin, that
     would be a way to pull a user out of their own scope or push one into it. */
  if (input.clinicId !== undefined) {
    if (auth.role !== Role.SUPER_ADMIN) {
      throw ApiError.forbidden(
        ERROR_CODES.INSUFFICIENT_PERMISSION,
        'Only a super admin can move a user between clinics.',
      );
    }
    user.clinic = input.clinicId ? toObjectId(input.clinicId, 'clinicId') : null;
  }

  /* Status changes go through `suspendUser` / `reactivateUser`, which handle
     session revocation and notification. Silently allowing it here would let an
     admin suspend someone while leaving their session live. */
  if (input.status !== undefined && input.status !== user.status) {
    throw ApiError.badRequest(
      ERROR_CODES.VALIDATION_FAILED,
      'Use the suspend or reactivate action to change account status.',
    );
  }

  await user.save();

  const changes = diffFields(before, {
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    clinic: user.clinic,
    status: user.status,
  });

  if (changes.length > 0) {
    void recordAudit({
      actor,
      action: 'user.updated',
      targetType: 'User',
      targetId: user._id,
      targetLabel: user.email,
      changes,
    });
  }

  return toUserDTO(user);
}

/* -------------------------------------------------------------------------- */
/*                                Role changes                                */
/* -------------------------------------------------------------------------- */

export async function changeRole(
  auth: AuthContext,
  userId: string,
  input: { role: Role; clinicId?: string; reason: string },
  actor: AuditActor,
) {
  const user = await loadUserInScope(auth, userId);

  /* Two separate guards: may I act on this person, and may I grant this role. */
  assertCanActOnUser(auth.role, user.role);
  assertCanAssignRole(auth.role, input.role);

  if (user._id.toString() === auth.userId.toString()) {
    throw ApiError.badRequest(
      ERROR_CODES.VALIDATION_FAILED,
      'You cannot change your own role.',
    );
  }

  /* Never strand the platform without a super admin. */
  if (user.role === Role.SUPER_ADMIN && input.role !== Role.SUPER_ADMIN) {
    await assertNotLastSuperAdmin(user._id);
  }

  const previousRole = user.role;
  user.role = input.role;

  if (input.role === Role.CLIENT) {
    user.clinic = null;
  } else if (input.clinicId) {
    user.clinic = toObjectId(input.clinicId, 'clinicId');
  } else if (!user.clinic && auth.clinicId) {
    user.clinic = auth.clinicId;
  }

  await user.save();

  /**
   * Revoke every session.
   *
   * The access token carries the old role, and while `authenticate` reads the
   * role from the database on each request, the session is the cleanest way to
   * guarantee the client re-fetches its permission list and re-renders. A user
   * left holding a UI built for their old role is confusing at best.
   */
  await revokeAllSessions(user._id, 'admin');

  void recordAudit({
    actor,
    action: 'user.role_changed',
    targetType: 'User',
    targetId: user._id,
    targetLabel: user.email,
    changes: [
      { field: 'role', from: previousRole, to: input.role },
      { field: 'reason', from: null, to: input.reason },
    ],
  });

  return toUserDTO(user);
}

async function assertNotLastSuperAdmin(excludingId: Types.ObjectId): Promise<void> {
  const others = await User.countDocuments({
    role: Role.SUPER_ADMIN,
    status: UserStatus.ACTIVE,
    _id: { $ne: excludingId },
  });

  if (others === 0) {
    throw ApiError.conflict(ERROR_CODES.CANNOT_DEMOTE_LAST_SUPER_ADMIN);
  }
}

/* -------------------------------------------------------------------------- */
/*                            Suspend & reactivate                            */
/* -------------------------------------------------------------------------- */

export async function suspendUser(
  auth: AuthContext,
  userId: string,
  input: { reason: string; until?: string },
  actor: AuditActor,
) {
  const user = await loadUserInScope(auth, userId);

  assertCanActOnUser(auth.role, user.role);

  if (user._id.toString() === auth.userId.toString()) {
    throw ApiError.badRequest(ERROR_CODES.CANNOT_DELETE_SELF, 'You cannot suspend yourself.');
  }

  if (user.role === Role.SUPER_ADMIN) {
    await assertNotLastSuperAdmin(user._id);
  }

  user.status = UserStatus.SUSPENDED;
  user.suspendedAt = new Date();
  user.suspendedReason = input.reason;
  user.suspendedUntil = input.until ? new Date(`${input.until}T23:59:59.999Z`) : null;
  await user.save();

  /* Kill their sessions now. Without this the suspension would not take effect
     until their access token expired — up to fifteen minutes of continued
     access for an account someone just decided to block. */
  const revoked = await revokeAllSessions(user._id, 'admin');

  /* A doctor being suspended must stop taking new bookings, or clients will
     book someone who cannot sign in. */
  if (user.role === Role.DOCTOR) {
    await Doctor.updateOne({ user: user._id }, { $set: { isAcceptingPatients: false } });
  }

  void recordAudit({
    actor,
    action: 'user.suspended',
    targetType: 'User',
    targetId: user._id,
    targetLabel: user.email,
    changes: [{ field: 'reason', from: null, to: input.reason }],
  });

  void sendEmail(accountSuspendedEmail(user.email, user.firstName, input.reason));

  return { ...toUserDTO(user), revokedSessions: revoked };
}

export async function reactivateUser(
  auth: AuthContext,
  userId: string,
  actor: AuditActor,
) {
  const user = await loadUserInScope(auth, userId);
  assertCanActOnUser(auth.role, user.role);

  user.status = UserStatus.ACTIVE;
  user.suspendedAt = null;
  user.suspendedReason = null;
  user.suspendedUntil = null;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  if (user.role === Role.DOCTOR) {
    await Doctor.updateOne({ user: user._id }, { $set: { isAcceptingPatients: true } });
  }

  void recordAudit({
    actor,
    action: 'user.reactivated',
    targetType: 'User',
    targetId: user._id,
    targetLabel: user.email,
  });

  return toUserDTO(user);
}

/**
 * Resend an invitation.
 *
 * Issues a *fresh* token and invalidates the old one, rather than re-sending
 * the original. If the first email went astray, the link in it may be sitting
 * in someone else's inbox.
 */
export async function resendInvite(auth: AuthContext, userId: string) {
  const user = await loadUserInScope(auth, userId);

  if (user.status !== UserStatus.INVITED) {
    throw ApiError.badRequest(
      ERROR_CODES.VALIDATION_FAILED,
      'That account has already been activated.',
    );
  }

  const token = generateSecureToken(32);

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        inviteTokenHash: hashToken(token),
        inviteExpiresAt: new Date(Date.now() + SECURITY.INVITE_TTL_DAYS * 86_400_000),
      },
    },
  );

  const inviter = await User.findById(auth.userId).select('firstName lastName').lean();

  const delivered = await sendEmail(
    inviteEmail(
      user.email,
      user.firstName,
      token,
      inviter ? fullName(inviter.firstName, inviter.lastName) : 'Your clinic',
      user.role.replace('_', ' '),
    ),
  );

  return { email: user.email, delivered };
}

/* -------------------------------------------------------------------------- */
/*                                   Loading                                  */
/* -------------------------------------------------------------------------- */

/**
 * Load a user the caller is allowed to see.
 *
 * An admin can reach their own clinic's staff and any client; a super admin can
 * reach anyone. Note this only establishes *visibility* — every mutating path
 * additionally calls `assertCanActOnUser` for the rank check.
 */
async function loadUserInScope(auth: AuthContext, userId: string): Promise<UserDocument> {
  const user = await User.findById(toObjectId(userId, 'userId'));

  if (!user) {
    throw ApiError.notFound(ERROR_CODES.USER_NOT_FOUND);
  }

  if (auth.role === Role.SUPER_ADMIN) return user;

  const sameClinic =
    user.clinic && auth.clinicId && user.clinic.toString() === auth.clinicId.toString();

  if (sameClinic || user.role === Role.CLIENT || user._id.toString() === auth.userId.toString()) {
    return user;
  }

  throw ApiError.notFound(ERROR_CODES.USER_NOT_FOUND);
}

/* -------------------------------------------------------------------------- */
/*                                  Clinics                                   */
/* -------------------------------------------------------------------------- */

export async function listClinics(auth: AuthContext) {
  /* An admin only ever needs their own; a super admin sees all. */
  const filter =
    auth.role === Role.SUPER_ADMIN ? {} : { _id: auth.clinicId ?? new Types.ObjectId() };

  const clinics = await Clinic.find(filter).sort({ name: 1 }).lean();
  return clinics.map((clinic) => toClinicDTO(clinic));
}
