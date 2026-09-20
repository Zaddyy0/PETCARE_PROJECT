/**
 * Business rules.
 *
 * Every magic number the product depends on lives here rather than being
 * sprinkled through services. When a clinic asks "why can't I cancel two hours
 * before?", the answer is one grep away — and changing it is one line, not a
 * hunt through five files that each hardcoded `2 * 60 * 60 * 1000`.
 */

export const APP_NAME = 'Pawsitive';
export const APP_TAGLINE = 'Every tail deserves a happy ending.';

/* -------------------------------------------------------------------------- */
/*                                   Booking                                  */
/* -------------------------------------------------------------------------- */

export const BOOKING = {
  /** Default granularity when a doctor has not customised their calendar. */
  DEFAULT_SLOT_MINUTES: 30,
  DEFAULT_BUFFER_MINUTES: 0,
  /** How far ahead the booking calendar opens. */
  DEFAULT_ADVANCE_DAYS: 60,
  /** Nobody books a slot that starts in the next few minutes. */
  DEFAULT_MIN_NOTICE_MINUTES: 60,
  /** Hard ceiling on a single availability query, matching the Zod schema. */
  MAX_SLOT_QUERY_DAYS: 62,
  /** Online self-service cancellation closes this long before the slot. */
  CANCELLATION_WINDOW_HOURS: 2,
  /** Same rule for moving an appointment. */
  RESCHEDULE_WINDOW_HOURS: 2,
  /** Reminder offsets, in hours before the slot. Ordered longest-first. */
  REMINDER_OFFSETS_HOURS: [24, 2] as const,
  /** An unconfirmed booking older than this is swept to `cancelled`. */
  PENDING_EXPIRY_HOURS: 48,
} as const;

/* -------------------------------------------------------------------------- */
/*                                   Reviews                                  */
/* -------------------------------------------------------------------------- */

export const REVIEWS = {
  /** A visit can be reviewed for this long afterwards, then the window shuts. */
  WINDOW_DAYS: 60,
  /** Free-edit period after posting, for fixing typos and second thoughts. */
  EDIT_WINDOW_HOURS: 24,
  MIN_COMMENT_LENGTH: 10,
  MAX_COMMENT_LENGTH: 2000,
  /** Reports needed before a review auto-hides pending moderation. */
  AUTO_MODERATION_REPORT_THRESHOLD: 3,
} as const;

/* -------------------------------------------------------------------------- */
/*                              Medical records                               */
/* -------------------------------------------------------------------------- */

export const MEDICAL = {
  /**
   * A clinician may freely correct their notes for this long. After that the
   * record locks and further changes are recorded as amendments with a reason,
   * preserving the original text.
   */
  FREE_EDIT_WINDOW_HOURS: 24,
  /** Reminder lead time for an upcoming vaccination dose. */
  VACCINATION_REMINDER_DAYS: 7,
  MAX_ATTACHMENTS_PER_RECORD: 10,
} as const;

/* -------------------------------------------------------------------------- */
/*                                  Security                                  */
/* -------------------------------------------------------------------------- */

export const SECURITY = {
  ACCESS_TOKEN_TTL_MINUTES: 15,
  REFRESH_TOKEN_TTL_DAYS: 7,
  /** `rememberMe` extends the refresh token rather than the access token. */
  REFRESH_TOKEN_TTL_DAYS_REMEMBERED: 30,
  PASSWORD_RESET_TTL_MINUTES: 30,
  EMAIL_VERIFY_TTL_HOURS: 48,
  INVITE_TTL_DAYS: 7,
  /** Failed sign-ins before the account locks. */
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_MINUTES: 15,
  /** Rolling window in which failures accumulate toward the lockout. */
  LOGIN_ATTEMPT_WINDOW_MINUTES: 15,
  /** bcrypt work factor. 12 is ~250ms on current hardware — the right trade. */
  BCRYPT_ROUNDS: 12,
  /** Previous password hashes retained to block immediate reuse. */
  PASSWORD_HISTORY_SIZE: 3,
  /** An impersonation session is deliberately short. */
  IMPERSONATION_TTL_MINUTES: 30,
} as const;

/* -------------------------------------------------------------------------- */
/*                                   Limits                                   */
/* -------------------------------------------------------------------------- */

export const LIMITS = {
  MAX_PETS_PER_CLIENT: 25,
  MAX_UPLOAD_BYTES: 5 * 1024 * 1024,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'] as const,
  ALLOWED_DOCUMENT_TYPES: ['application/pdf'] as const,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  MAX_CURSOR_PAGE_SIZE: 50,
  /** Notifications older than this are dropped by a TTL index. */
  NOTIFICATION_RETENTION_DAYS: 90,
  /** Audit rows are kept far longer — they are the compliance artefact. */
  AUDIT_RETENTION_DAYS: 730,
} as const;

/* -------------------------------------------------------------------------- */
/*                                 Rate limits                                */
/* -------------------------------------------------------------------------- */

export const RATE_LIMITS = {
  /** Broad ceiling per IP, generous enough never to hit a real user. */
  GLOBAL: { windowMs: 60_000, max: 300 },
  /** Sign-in and registration: tight, because this is where guessing happens. */
  AUTH: { windowMs: 15 * 60_000, max: 10 },
  /** Password reset and invite resend: tighter still — these send email. */
  SENSITIVE: { windowMs: 60 * 60_000, max: 5 },
  /** Writes cost more than reads. */
  MUTATION: { windowMs: 60_000, max: 60 },
  UPLOAD: { windowMs: 60_000, max: 20 },
} as const;

/* -------------------------------------------------------------------------- */
/*                              Presentation                                  */
/* -------------------------------------------------------------------------- */

/** Fallback illustrations, keyed by species, for a pet with no photo. */
export const DEFAULT_PET_EMOJI: Record<string, string> = {
  dog: '🐕',
  cat: '🐈',
  bird: '🦜',
  rabbit: '🐇',
  hamster: '🐹',
  guinea_pig: '🐹',
  ferret: '🦦',
  reptile: '🦎',
  fish: '🐠',
  horse: '🐴',
  other: '🐾',
};

/** Common specializations offered as suggestions when editing a doctor. */
export const SPECIALIZATION_SUGGESTIONS = [
  'General Practice',
  'Surgery',
  'Dermatology',
  'Dentistry',
  'Cardiology',
  'Oncology',
  'Ophthalmology',
  'Orthopaedics',
  'Neurology',
  'Internal Medicine',
  'Emergency & Critical Care',
  'Exotic Animals',
  'Behaviour',
  'Nutrition',
  'Radiology',
  'Anaesthesiology',
] as const;

/** Common vaccines, to speed up the vaccination form. */
export const VACCINE_SUGGESTIONS: Record<string, string[]> = {
  dog: ['Rabies', 'DHPP', 'Leptospirosis', 'Bordetella', 'Canine Influenza', 'Lyme'],
  cat: ['Rabies', 'FVRCP', 'FeLV', 'FIV'],
  rabbit: ['Myxomatosis', 'RHDV', 'RHDV2'],
  ferret: ['Rabies', 'Canine Distemper'],
  horse: ['Tetanus', 'Equine Influenza', 'West Nile Virus', 'Rabies'],
  bird: ['Polyomavirus', "Pacheco's Disease"],
};
