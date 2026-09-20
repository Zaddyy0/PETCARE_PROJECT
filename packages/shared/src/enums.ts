/**
 * Domain enumerations.
 *
 * Every enum here follows the same three-part shape:
 *
 *   1. a `const` tuple  — feeds `z.enum()` and Mongoose `enum:` directly
 *   2. a `const` object — ergonomic, autocompleted references in app code
 *   3. a union type     — the compile-time contract
 *
 * We deliberately avoid TypeScript's `enum` keyword: it emits a runtime object
 * that bundlers cannot tree-shake and it behaves badly under `isolatedModules`,
 * which the web client compiles with.
 */

/* -------------------------------------------------------------------------- */
/*                                    Roles                                   */
/* -------------------------------------------------------------------------- */

export const ROLES = ['client', 'doctor', 'admin', 'super_admin'] as const;
export type Role = (typeof ROLES)[number];

export const Role = {
  CLIENT: 'client',
  DOCTOR: 'doctor',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
} as const satisfies Record<string, Role>;

/**
 * Numeric rank for privilege comparisons.
 *
 * Authorization is expressed as "at least this rank" rather than as a list of
 * roles wherever the rule is genuinely hierarchical, so adding a role later
 * does not mean auditing every route. Where a rule is *not* hierarchical
 * (a doctor may write medical notes, an admin may not) we check the role
 * explicitly instead — see `permissions.ts`.
 */
export const ROLE_RANK: Record<Role, number> = {
  client: 10,
  doctor: 20,
  admin: 30,
  super_admin: 40,
};

/** Human-facing labels. Kept beside the enum so the two never drift. */
export const ROLE_LABELS: Record<Role, string> = {
  client: 'Pet Parent',
  doctor: 'Veterinarian',
  admin: 'Clinic Admin',
  super_admin: 'Super Admin',
};

/* -------------------------------------------------------------------------- */
/*                                 Account state                              */
/* -------------------------------------------------------------------------- */

export const USER_STATUSES = ['active', 'invited', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const UserStatus = {
  /** Normal, can sign in. */
  ACTIVE: 'active',
  /** Created by an admin; awaiting first sign-in via invite token. */
  INVITED: 'invited',
  /** Temporarily blocked by an admin. Reversible. */
  SUSPENDED: 'suspended',
  /** Self-closed or hard-disabled. Retained for referential integrity. */
  DEACTIVATED: 'deactivated',
} as const satisfies Record<string, UserStatus>;

/** Only these states may hold a session. */
export const SIGNIN_ALLOWED_STATUSES: readonly UserStatus[] = [UserStatus.ACTIVE];

/* -------------------------------------------------------------------------- */
/*                                     Pets                                   */
/* -------------------------------------------------------------------------- */

export const PET_SPECIES = [
  'dog',
  'cat',
  'bird',
  'rabbit',
  'hamster',
  'guinea_pig',
  'ferret',
  'reptile',
  'fish',
  'horse',
  'other',
] as const;
export type PetSpecies = (typeof PET_SPECIES)[number];

export const PetSpecies = {
  DOG: 'dog',
  CAT: 'cat',
  BIRD: 'bird',
  RABBIT: 'rabbit',
  HAMSTER: 'hamster',
  GUINEA_PIG: 'guinea_pig',
  FERRET: 'ferret',
  REPTILE: 'reptile',
  FISH: 'fish',
  HORSE: 'horse',
  OTHER: 'other',
} as const satisfies Record<string, PetSpecies>;

export const PET_SPECIES_LABELS: Record<PetSpecies, string> = {
  dog: 'Dog',
  cat: 'Cat',
  bird: 'Bird',
  rabbit: 'Rabbit',
  hamster: 'Hamster',
  guinea_pig: 'Guinea Pig',
  ferret: 'Ferret',
  reptile: 'Reptile',
  fish: 'Fish',
  horse: 'Horse',
  other: 'Other',
};

export const PET_SEXES = ['male', 'female', 'unknown'] as const;
export type PetSex = (typeof PET_SEXES)[number];

export const PetSex = {
  MALE: 'male',
  FEMALE: 'female',
  UNKNOWN: 'unknown',
} as const satisfies Record<string, PetSex>;

export const PET_STATUSES = ['active', 'archived', 'deceased'] as const;
export type PetStatus = (typeof PET_STATUSES)[number];

export const PetStatus = {
  ACTIVE: 'active',
  /** Soft-deleted. Medical history is legally worth keeping, so we never drop it. */
  ARCHIVED: 'archived',
  DECEASED: 'deceased',
} as const satisfies Record<string, PetStatus>;

/* -------------------------------------------------------------------------- */
/*                                Appointments                                */
/* -------------------------------------------------------------------------- */

export const APPOINTMENT_STATUSES = [
  'pending',
  'confirmed',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const AppointmentStatus = {
  /** Booked by a client, not yet accepted by the clinic. */
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  /** Doctor has started the consultation. */
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  /** Client never arrived. Counts against no-show analytics, frees nothing retroactively. */
  NO_SHOW: 'no_show',
} as const satisfies Record<string, AppointmentStatus>;

/**
 * Statuses that occupy a doctor's calendar slot.
 *
 * This drives the `blocksSlot` flag on the Appointment model, which in turn
 * backs the partial unique index that makes double-booking impossible at the
 * database level. Changing this list changes booking correctness — see
 * `models/appointment.model.ts` before touching it.
 */
export const SLOT_BLOCKING_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS,
];

/** Terminal states — no further transitions are legal. */
export const TERMINAL_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELLED,
  AppointmentStatus.NO_SHOW,
];

/**
 * The legal status transition graph.
 *
 * Encoding this as data rather than as scattered `if` statements means the
 * state machine can be unit-tested on its own and rendered in the UI to grey
 * out impossible actions.
 */
export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const APPOINTMENT_TYPES = [
  'consultation',
  'vaccination',
  'follow_up',
  'dental',
  'surgery',
  'grooming',
  'diagnostic',
  'emergency',
] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const AppointmentType = {
  CONSULTATION: 'consultation',
  VACCINATION: 'vaccination',
  FOLLOW_UP: 'follow_up',
  DENTAL: 'dental',
  SURGERY: 'surgery',
  GROOMING: 'grooming',
  DIAGNOSTIC: 'diagnostic',
  EMERGENCY: 'emergency',
} as const satisfies Record<string, AppointmentType>;

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  consultation: 'General Consultation',
  vaccination: 'Vaccination',
  follow_up: 'Follow-up Visit',
  dental: 'Dental Care',
  surgery: 'Surgery',
  grooming: 'Grooming',
  diagnostic: 'Diagnostics & Imaging',
  emergency: 'Emergency',
};

/** Who ended the appointment early. Drives refund and no-show analytics. */
export const CANCELLED_BY = ['client', 'doctor', 'admin', 'system'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

/* -------------------------------------------------------------------------- */
/*                              Medical records                               */
/* -------------------------------------------------------------------------- */

export const VACCINATION_STATUSES = ['scheduled', 'administered', 'overdue', 'skipped'] as const;
export type VaccinationStatus = (typeof VACCINATION_STATUSES)[number];

export const VaccinationStatus = {
  SCHEDULED: 'scheduled',
  ADMINISTERED: 'administered',
  /** Derived nightly by a job when `dueAt` passes while still `scheduled`. */
  OVERDUE: 'overdue',
  SKIPPED: 'skipped',
} as const satisfies Record<string, VaccinationStatus>;

export const MEDICAL_RECORD_TYPES = [
  'consultation',
  'vaccination',
  'surgery',
  'lab_result',
  'prescription',
  'imaging',
  'note',
] as const;
export type MedicalRecordType = (typeof MEDICAL_RECORD_TYPES)[number];

export const MedicalRecordType = {
  CONSULTATION: 'consultation',
  VACCINATION: 'vaccination',
  SURGERY: 'surgery',
  LAB_RESULT: 'lab_result',
  PRESCRIPTION: 'prescription',
  IMAGING: 'imaging',
  NOTE: 'note',
} as const satisfies Record<string, MedicalRecordType>;

/* -------------------------------------------------------------------------- */
/*                                  Reviews                                   */
/* -------------------------------------------------------------------------- */

export const REVIEW_STATUSES = ['published', 'pending_moderation', 'hidden', 'removed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const ReviewStatus = {
  PUBLISHED: 'published',
  /** Flagged by the profanity/risk filter, awaiting an admin decision. */
  PENDING_MODERATION: 'pending_moderation',
  /** Hidden by an admin but retained and still visible to its author. */
  HIDDEN: 'hidden',
  /** Withdrawn by the author. */
  REMOVED: 'removed',
} as const satisfies Record<string, ReviewStatus>;

/** Only these states contribute to a doctor's aggregate rating. */
export const RATED_REVIEW_STATUSES: readonly ReviewStatus[] = [ReviewStatus.PUBLISHED];

export const MIN_RATING = 1;
export const MAX_RATING = 5;

/* -------------------------------------------------------------------------- */
/*                                Notifications                               */
/* -------------------------------------------------------------------------- */

export const NOTIFICATION_TYPES = [
  'appointment_booked',
  'appointment_confirmed',
  'appointment_cancelled',
  'appointment_reminder',
  'appointment_completed',
  'vaccination_due',
  'medical_record_added',
  'review_received',
  'account_invited',
  'account_suspended',
  'system_announcement',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NotificationType = {
  APPOINTMENT_BOOKED: 'appointment_booked',
  APPOINTMENT_CONFIRMED: 'appointment_confirmed',
  APPOINTMENT_CANCELLED: 'appointment_cancelled',
  APPOINTMENT_REMINDER: 'appointment_reminder',
  APPOINTMENT_COMPLETED: 'appointment_completed',
  VACCINATION_DUE: 'vaccination_due',
  MEDICAL_RECORD_ADDED: 'medical_record_added',
  REVIEW_RECEIVED: 'review_received',
  ACCOUNT_INVITED: 'account_invited',
  ACCOUNT_SUSPENDED: 'account_suspended',
  SYSTEM_ANNOUNCEMENT: 'system_announcement',
} as const satisfies Record<string, NotificationType>;

export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'push'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/* -------------------------------------------------------------------------- */
/*                                 Audit trail                                */
/* -------------------------------------------------------------------------- */

export const AUDIT_ACTIONS = [
  'user.created',
  'user.updated',
  'user.role_changed',
  'user.suspended',
  'user.reactivated',
  'user.deleted',
  'user.impersonated',
  'doctor.created',
  'doctor.updated',
  'doctor.availability_changed',
  'clinic.created',
  'clinic.updated',
  'appointment.created',
  'appointment.status_changed',
  'appointment.rescheduled',
  'medical_record.created',
  'medical_record.updated',
  'review.moderated',
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.password_reset',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/* -------------------------------------------------------------------------- */
/*                               Days of the week                             */
/* -------------------------------------------------------------------------- */

/** `0` is Sunday, matching `Date.prototype.getUTCDay()`. */
export const DAYS_OF_WEEK = [0, 1, 2, 3, 4, 5, 6] as const;
export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const DAY_LABELS: Record<DayOfWeek, string> = {
  0: 'Sunday',
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
};

export const DAY_LABELS_SHORT: Record<DayOfWeek, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};
