/**
 * User accounts — identity, credentials and role.
 *
 * Differences from the previous `User` model that matter:
 *
 *   • **A role exists.** The old model had `name`, `email` and `password` and
 *     nothing else, so there was no way to express a doctor, an admin or a
 *     super admin. Everything in the platform's authorization story starts here.
 *
 *   • **`passwordHash` is `select: false`.** The old code kept the password
 *     selectable and stripped it by hand with `.select('-password')` at each
 *     call site, which works right up until somebody adds a query and forgets.
 *     Now it is excluded by default and must be asked for explicitly, so the
 *     failure mode is "the hash is missing when I need it" rather than "the
 *     hash was returned to a client".
 *
 *   • **Failed sign-ins are counted and the account locks.** Without this an
 *     attacker gets unlimited password guesses against a known email.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  ROLES,
  Role,
  SECURITY,
  USER_STATUSES,
  UserStatus,
  type Role as RoleType,
  type UserStatus as UserStatusType,
} from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface UserMedia {
  url: string;
  publicId: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  format?: string;
  bytes?: number;
}

export interface UserAddress {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface UserNotificationPreferences {
  email: boolean;
  inApp: boolean;
  push: boolean;
  appointmentReminders: boolean;
  vaccinationReminders: boolean;
  marketing: boolean;
}

export interface IUser {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  emailVerified: boolean;
  emailVerificationTokenHash?: string | null;
  emailVerificationExpiresAt?: Date | null;

  /** Never selected by default. See the note at the top of this file. */
  passwordHash: string;
  /** Recent hashes, so a "new" password cannot be one of the last few. */
  passwordHistory: string[];
  passwordChangedAt?: Date | null;
  passwordResetTokenHash?: string | null;
  passwordResetExpiresAt?: Date | null;

  inviteTokenHash?: string | null;
  inviteExpiresAt?: Date | null;
  invitedBy?: Types.ObjectId | null;

  phone?: string;
  phoneVerified: boolean;

  role: RoleType;
  status: UserStatusType;
  /** Set for doctors and admins; null for clients and super admins. */
  clinic?: Types.ObjectId | null;

  avatar?: UserMedia | null;
  address?: UserAddress | null;
  locale: string;
  timezone: string;

  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
  lastLoginIp?: string | null;

  suspendedAt?: Date | null;
  suspendedReason?: string | null;
  suspendedUntil?: Date | null;

  notificationPreferences: UserNotificationPreferences;

  createdAt: Date;
  updatedAt: Date;
}

export interface IUserMethods {
  get fullName(): string;
  isLocked(): boolean;
  canSignIn(): boolean;
}

export interface UserModel extends Model<IUser, Record<string, never>, IUserMethods> {
  findByEmailWithPassword(email: string): Promise<UserDocument | null>;
}

export type UserDocument = HydratedDocument<IUser, IUserMethods>;

const mediaSchema = new Schema<UserMedia>(
  {
    url: { type: String, required: true },
    publicId: { type: String, required: true },
    thumbnailUrl: String,
    width: Number,
    height: Number,
    format: String,
    bytes: Number,
  },
  { _id: false },
);

const addressSchema = new Schema<UserAddress>(
  {
    line1: { type: String, required: true, trim: true, maxlength: 120 },
    line2: { type: String, trim: true, maxlength: 120 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    postalCode: { type: String, required: true, trim: true, maxlength: 16 },
    country: { type: String, required: true, trim: true, maxlength: 60 },
  },
  { _id: false },
);

const userSchema = new Schema<IUser, UserModel, IUserMethods>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      index: true,
    },
    emailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, default: null, select: false },
    emailVerificationExpiresAt: { type: Date, default: null, select: false },

    passwordHash: { type: String, required: true, select: false },
    passwordHistory: { type: [String], default: [], select: false },
    passwordChangedAt: { type: Date, default: null },
    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },

    inviteTokenHash: { type: String, default: null, select: false },
    inviteExpiresAt: { type: Date, default: null, select: false },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    phone: { type: String, trim: true, maxlength: 20 },
    phoneVerified: { type: Boolean, default: false },

    role: { type: String, enum: ROLES, required: true, default: Role.CLIENT, index: true },
    status: { type: String, enum: USER_STATUSES, required: true, default: UserStatus.ACTIVE },

    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', default: null },

    avatar: { type: mediaSchema, default: null },
    address: { type: addressSchema, default: null },
    locale: { type: String, default: 'en', maxlength: 10 },
    timezone: { type: String, default: 'Asia/Kolkata', maxlength: 64 },

    /* Lockout bookkeeping. Hidden by default — it is nobody's business but the
       auth service's, and exposing it tells an attacker how close they are. */
    failedLoginAttempts: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null, select: false },

    suspendedAt: { type: Date, default: null },
    suspendedReason: { type: String, default: null, maxlength: 300 },
    suspendedUntil: { type: Date, default: null },

    notificationPreferences: {
      email: { type: Boolean, default: true },
      inApp: { type: Boolean, default: true },
      push: { type: Boolean, default: false },
      appointmentReminders: { type: Boolean, default: true },
      vaccinationReminders: { type: Boolean, default: true },
      marketing: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
    /* Mongoose's default `minimize` drops empty objects, which would silently
       remove `notificationPreferences` if every flag were false. */
    minimize: false,
  },
);

/* -------------------------------------------------------------------------- */
/*                                  Indexes                                   */
/* -------------------------------------------------------------------------- */

/**
 * Compound indexes matching the queries the admin console actually runs.
 *
 * The order of keys follows the equality-then-sort rule: fields filtered by
 * equality first, then the field sorted on. Reversed, Mongo can use the index
 * to filter or to sort but not both, and falls back to an in-memory sort that
 * fails outright past 32MB.
 */
userSchema.index({ clinic: 1, role: 1, status: 1, createdAt: -1 });
userSchema.index({ role: 1, createdAt: -1 });
userSchema.index({ status: 1, createdAt: -1 });

/** Text search over the admin user table. */
userSchema.index(
  { firstName: 'text', lastName: 'text', email: 'text' },
  { name: 'user_search', weights: { email: 3, firstName: 2, lastName: 2 } },
);

/**
 * Unique indexes on the credential tokens — **partial**, not sparse.
 *
 * This distinction is subtle and bites hard. A `sparse` index omits documents
 * where the field is *missing*; it does **not** omit documents where the field
 * is present and `null`. Both fields here declare `default: null`, so every
 * account without a pending reset stores an explicit null — and a sparse unique
 * index therefore indexes all of them and rejects the second one.
 *
 * The symptom is bizarre enough to be worth recording: the *second ever user
 * registration* fails with "duplicate key on inviteTokenHash: null", on a route
 * that never touches invitations.
 *
 * `partialFilterExpression` with `$type: 'string'` indexes only rows that
 * actually hold a token, which is what was intended.
 */
userSchema.index(
  { passwordResetTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { passwordResetTokenHash: { $type: 'string' } },
    name: 'password_reset_token',
  },
);

userSchema.index(
  { inviteTokenHash: 1 },
  {
    unique: true,
    partialFilterExpression: { inviteTokenHash: { $type: 'string' } },
    name: 'invite_token',
  },
);

/* -------------------------------------------------------------------------- */
/*                             Virtuals & methods                             */
/* -------------------------------------------------------------------------- */

userSchema.virtual('fullName').get(function fullNameGetter(this: IUser) {
  return `${this.firstName} ${this.lastName}`.trim();
});

/** A doctor's profile, joined on demand rather than duplicated here. */
userSchema.virtual('doctorProfile', {
  ref: 'Doctor',
  localField: '_id',
  foreignField: 'user',
  justOne: true,
});

userSchema.methods['isLocked'] = function isLocked(this: UserDocument): boolean {
  return Boolean(this.lockedUntil && this.lockedUntil.getTime() > Date.now());
};

userSchema.methods['canSignIn'] = function canSignIn(this: UserDocument): boolean {
  return this.status === UserStatus.ACTIVE && !this.isLocked();
};

/**
 * Fetch a user *with* their credential fields, for the sign-in path only.
 *
 * Having one named method for this makes every use greppable. A reviewer can
 * check the handful of call sites rather than auditing every `.select()` in the
 * codebase for an accidental `+passwordHash`.
 */
userSchema.statics['findByEmailWithPassword'] = function findByEmailWithPassword(
  this: UserModel,
  email: string,
) {
  return this.findOne({ email: email.toLowerCase().trim() }).select(
    '+passwordHash +failedLoginAttempts +lockedUntil +passwordHistory',
  );
};

/* -------------------------------------------------------------------------- */
/*                                Serialisation                               */
/* -------------------------------------------------------------------------- */

/**
 * A defence-in-depth scrub.
 *
 * Services map documents to DTOs before responding, so this should never be
 * the thing that saves us — but `select: false` can be overridden, and a
 * `res.json(user)` slipped into a debug branch should still not emit a hash.
 * Three independent layers have to fail before a credential escapes.
 */
applyStandardTransform(userSchema, {
  omit: [
    'passwordHash',
    'passwordHistory',
    'passwordResetTokenHash',
    'passwordResetExpiresAt',
    'emailVerificationTokenHash',
    'emailVerificationExpiresAt',
    'inviteTokenHash',
    'inviteExpiresAt',
    'failedLoginAttempts',
    'lockedUntil',
    'lastLoginIp',
  ],
});

export const User = (mongoose.models['User'] as UserModel) ??
  mongoose.model<IUser, UserModel>('User', userSchema);

export { SECURITY as USER_SECURITY_LIMITS };
