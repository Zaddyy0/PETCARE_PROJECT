import type { Role, UserStatus, DayOfWeek } from '../enums.js';
import type { Permission } from '../permissions.js';
import type {
  Address,
  ClinicId,
  DoctorId,
  ISODateString,
  MediaAsset,
  Money,
  PhoneNumber,
  TimeString,
  Timestamps,
  UserId,
} from './common.js';

/* -------------------------------------------------------------------------- */
/*                                    User                                    */
/* -------------------------------------------------------------------------- */

/**
 * The public shape of a user account.
 *
 * Note what is absent: no `password`, no `refreshTokens`, no
 * `failedLoginAttempts`, no `lockedUntil`. Those live on the Mongoose document
 * and are stripped by the DTO mapper. Making the wire type *structurally*
 * unable to hold a credential means a careless `res.json(userDoc)` fails to
 * compile rather than leaking a hash.
 */
export interface User extends Timestamps {
  id: UserId;
  firstName: string;
  lastName: string;
  /** Convenience, computed server-side; clients should not re-derive it. */
  fullName: string;
  email: string;
  emailVerified: boolean;
  phone?: PhoneNumber;
  role: Role;
  status: UserStatus;
  avatar?: MediaAsset;
  address?: Address;
  /** Set for doctors and admins; `null` for clients and super admins. */
  clinicId: ClinicId | null;
  /** Present only when `role === 'doctor'`. */
  doctorId?: DoctorId;
  locale: string;
  timezone: string;
  lastLoginAt?: ISODateString;
  notificationPreferences: NotificationPreferences;
}

export interface NotificationPreferences {
  email: boolean;
  inApp: boolean;
  push: boolean;
  appointmentReminders: boolean;
  vaccinationReminders: boolean;
  marketing: boolean;
}

/** The caller's own profile, enriched with what the UI needs to render itself. */
export interface CurrentUser extends User {
  permissions: Permission[];
  /** True while a super admin is viewing the platform as this user. */
  isImpersonating?: boolean;
  impersonatedBy?: UserId;
}

/* -------------------------------------------------------------------------- */
/*                                Authentication                              */
/* -------------------------------------------------------------------------- */

export interface AuthTokens {
  /**
   * Short-lived (15 min). Held in memory by the web client, never in
   * `localStorage` — a token at rest in storage is a token an XSS payload can
   * read. The refresh token rides in an httpOnly cookie the page cannot touch.
   */
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthSession {
  user: CurrentUser;
  tokens: AuthTokens;
}

export interface LoginPayload {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterPayload {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone?: string;
  acceptedTerms: boolean;
}

export interface ForgotPasswordPayload {
  email: string;
}

export interface ResetPasswordPayload {
  token: string;
  password: string;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

export interface AcceptInvitePayload {
  token: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

/** The decoded JWT body. Kept small — it travels on every single request. */
export interface AccessTokenClaims {
  sub: UserId;
  role: Role;
  clinicId: ClinicId | null;
  /** Session id, so a single device can be revoked without a global logout. */
  sid: string;
  /** Present only during an impersonation session. */
  imp?: UserId;
  iat: number;
  exp: number;
}

/* -------------------------------------------------------------------------- */
/*                                   Clinic                                   */
/* -------------------------------------------------------------------------- */

export interface Clinic extends Timestamps {
  id: ClinicId;
  name: string;
  slug: string;
  description?: string;
  email: string;
  phone: string;
  address: Address;
  logo?: MediaAsset;
  coverImage?: MediaAsset;
  timezone: string;
  currency: string;
  isActive: boolean;
  /** Denormalised counters, maintained on write. Cheap dashboards, no `$count`. */
  stats: {
    doctorCount: number;
    clientCount: number;
    appointmentCount: number;
  };
}

/* -------------------------------------------------------------------------- */
/*                                   Doctor                                   */
/* -------------------------------------------------------------------------- */

/**
 * A doctor's professional profile, stored separately from their `User` account.
 *
 * Splitting them keeps the auth-hot `users` collection small — it is read on
 * every authenticated request — while the profile, with its availability rules
 * and long bio, is fetched only when someone actually views or books a doctor.
 */
export interface Doctor extends Timestamps {
  id: DoctorId;
  userId: UserId;
  clinicId: ClinicId;
  /** Denormalised from the user record for listing pages. */
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  avatar?: MediaAsset;
  title: string;
  bio: string;
  specializations: string[];
  qualifications: Qualification[];
  licenseNumber: string;
  licenseExpiresAt?: ISODateString;
  yearsOfExperience: number;
  languages: string[];
  consultationFee: Money;
  availability: DoctorAvailability;
  rating: DoctorRating;
  isAcceptingPatients: boolean;
  isActive: boolean;
}

export interface Qualification {
  degree: string;
  institution: string;
  year: number;
}

/**
 * Aggregate rating, maintained incrementally rather than recomputed.
 *
 * Re-averaging every review on each read is fine at 50 reviews and a problem at
 * 50,000. We keep a running sum and count so a new review is an `$inc`, and the
 * average is derived. `distribution` powers the 5-bar histogram without a
 * separate aggregation query.
 */
export interface DoctorRating {
  average: number;
  count: number;
  /** Sum of all published ratings; `average === sum / count`. */
  sum: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

/* -------------------------------------------------------------------------- */
/*                                 Availability                               */
/* -------------------------------------------------------------------------- */

/**
 * Availability is stored as *rules*, not as pre-generated slots.
 *
 * Materialising every slot for every doctor for the next year would be millions
 * of near-identical rows that go stale the moment a doctor changes their hours.
 * Instead we store a weekly pattern plus dated exceptions and generate the slot
 * grid on demand for the requested window, subtracting booked appointments.
 * Cheap to compute, impossible to desynchronise.
 */
export interface DoctorAvailability {
  timezone: string;
  /** Appointment granularity in minutes. */
  slotDurationMinutes: number;
  /** Gap between consultations, for notes and room turnover. */
  bufferMinutes: number;
  /** How far ahead clients may book. */
  advanceBookingDays: number;
  /** Minimum lead time, so nobody books a slot starting in 90 seconds. */
  minimumNoticeMinutes: number;
  weekly: WeeklyAvailability[];
  /** Dated overrides: holidays, conference days, one-off extended hours. */
  overrides: AvailabilityOverride[];
}

export interface WeeklyAvailability {
  dayOfWeek: DayOfWeek;
  /** Empty array means the doctor does not work that day. */
  blocks: TimeBlock[];
}

export interface TimeBlock {
  start: TimeString;
  end: TimeString;
}

export interface AvailabilityOverride {
  /** `YYYY-MM-DD` in the doctor's timezone. */
  date: string;
  /** When true, `blocks` is ignored and the whole day is closed. */
  isUnavailable: boolean;
  blocks: TimeBlock[];
  reason?: string;
}

/** One bookable slot, as returned to the booking UI. */
export interface AvailableSlot {
  start: ISODateString;
  end: ISODateString;
  /** False when the grid position exists but is already taken. */
  isAvailable: boolean;
}

export interface SlotQuery {
  doctorId: DoctorId;
  /** Inclusive `YYYY-MM-DD`. */
  from: string;
  /** Inclusive `YYYY-MM-DD`. */
  to: string;
}

/* -------------------------------------------------------------------------- */
/*                          Admin user-management DTOs                        */
/* -------------------------------------------------------------------------- */

export interface CreateUserPayload {
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  phone?: string;
  clinicId?: ClinicId;
  /** When true the user receives an invite email instead of a password. */
  sendInvite?: boolean;
  password?: string;
}

export interface UpdateUserPayload {
  firstName?: string;
  lastName?: string;
  phone?: string;
  address?: Address;
  locale?: string;
  timezone?: string;
  notificationPreferences?: Partial<NotificationPreferences>;
}

export interface CreateDoctorPayload extends CreateUserPayload {
  title: string;
  bio: string;
  specializations: string[];
  licenseNumber: string;
  yearsOfExperience: number;
  consultationFeeMinor: number;
  languages?: string[];
  qualifications?: Qualification[];
}

export interface UserListQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: Role;
  status?: UserStatus;
  clinicId?: ClinicId;
  sort?: 'createdAt' | 'lastLoginAt' | 'firstName';
  order?: 'asc' | 'desc';
}

export interface DoctorListQuery {
  page?: number;
  limit?: number;
  search?: string;
  specialization?: string;
  clinicId?: ClinicId;
  minRating?: number;
  isAcceptingPatients?: boolean;
  sort?: 'rating' | 'experience' | 'fee' | 'name';
  order?: 'asc' | 'desc';
}
