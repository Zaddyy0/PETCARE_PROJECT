/**
 * User serialisation.
 *
 * Mapping is **explicit** — field by field — rather than spreading a document
 * and deleting what should not go out. A spread is subtractive: add a
 * `twoFactorSecret` to the model later and it ships to clients until somebody
 * remembers to exclude it. An explicit mapper is additive, so a new field is
 * invisible until a human decides it should be public.
 *
 * This is the third and last layer of credential protection, after
 * `select: false` on the schema and the `toJSON` scrub. Any one of them should
 * be enough; all three have to fail before a hash escapes.
 */

import type { Types } from 'mongoose';
import {
  ROLE_PERMISSIONS,
  fullName,
  type Clinic as ClinicDTO,
  type CurrentUser,
  type User as UserDTO,
} from '@pawsitive/shared';
import type { IClinic } from '../models/clinic.model.js';
import type { IUser } from '../models/user.model.js';

/** Anything with the shape of a user row — hydrated document or `.lean()` result. */
type UserLike = Pick<
  IUser,
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'emailVerified'
  | 'role'
  | 'status'
  | 'locale'
  | 'timezone'
  | 'notificationPreferences'
  | 'createdAt'
  | 'updatedAt'
> &
  Partial<Pick<IUser, 'phone' | 'phoneVerified' | 'avatar' | 'address' | 'clinic' | 'lastLoginAt'>> & {
    _id: Types.ObjectId;
  };

export function toUserDTO(user: UserLike, doctorId?: Types.ObjectId | null): UserDTO {
  const dto: UserDTO = {
    id: user._id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: fullName(user.firstName, user.lastName),
    email: user.email,
    emailVerified: user.emailVerified,
    role: user.role,
    status: user.status,
    clinicId: user.clinic ? user.clinic.toString() : null,
    locale: user.locale,
    timezone: user.timezone,
    notificationPreferences: { ...user.notificationPreferences },
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };

  if (user.phone) {
    dto.phone = { e164: user.phone, verified: user.phoneVerified ?? false };
  }

  if (user.avatar) {
    dto.avatar = {
      url: user.avatar.url,
      publicId: user.avatar.publicId,
      ...(user.avatar.thumbnailUrl ? { thumbnailUrl: user.avatar.thumbnailUrl } : {}),
      ...(user.avatar.width ? { width: user.avatar.width } : {}),
      ...(user.avatar.height ? { height: user.avatar.height } : {}),
    };
  }

  if (user.address) {
    dto.address = { ...user.address };
  }

  if (user.lastLoginAt) {
    dto.lastLoginAt = user.lastLoginAt.toISOString();
  }

  if (doctorId) {
    dto.doctorId = doctorId.toString();
  }

  return dto;
}

/**
 * The caller's own profile, with the permission list attached.
 *
 * The client uses this to decide what to render — which nav items exist, which
 * buttons appear. Sending the resolved list rather than letting the client
 * derive it from `role` means the two can never disagree about what a role can
 * do, and a permission change ships without a frontend release.
 *
 * It is a convenience for rendering, never a substitute for enforcement: the
 * server re-derives permissions from the database role on every request.
 */
export function toCurrentUserDTO(
  user: UserLike,
  options: { doctorId?: Types.ObjectId | null; impersonatorId?: Types.ObjectId | null } = {},
): CurrentUser {
  const base = toUserDTO(user, options.doctorId);

  const current: CurrentUser = {
    ...base,
    permissions: [...ROLE_PERMISSIONS[user.role]],
  };

  if (options.impersonatorId) {
    current.isImpersonating = true;
    current.impersonatedBy = options.impersonatorId.toString();
  }

  return current;
}

type ClinicLike = IClinic & { _id: Types.ObjectId };

export function toClinicDTO(clinic: ClinicLike): ClinicDTO {
  const dto: ClinicDTO = {
    id: clinic._id.toString(),
    name: clinic.name,
    slug: clinic.slug,
    email: clinic.email,
    phone: clinic.phone,
    address: { ...clinic.address },
    timezone: clinic.timezone,
    currency: clinic.currency,
    isActive: clinic.isActive,
    stats: { ...clinic.stats },
    createdAt: clinic.createdAt.toISOString(),
    updatedAt: clinic.updatedAt.toISOString(),
  };

  if (clinic.description) dto.description = clinic.description;
  if (clinic.logo) dto.logo = { url: clinic.logo.url, publicId: clinic.logo.publicId };
  if (clinic.coverImage) {
    dto.coverImage = { url: clinic.coverImage.url, publicId: clinic.coverImage.publicId };
  }

  return dto;
}
