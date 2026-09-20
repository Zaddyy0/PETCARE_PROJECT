/**
 * The error-code catalogue.
 *
 * `code` is the contract; `message` is copy. Clients branch on the code and
 * display the message, which means prose can be reworded or translated without
 * breaking a single client. Every code is listed here so the web app can map
 * each one to a specific recovery affordance — `APPOINTMENT_SLOT_TAKEN` should
 * refresh the slot grid, not show a generic red toast.
 */

export const ERROR_CODES = {
  /* Generic ---------------------------------------------------------------- */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  /* Authentication --------------------------------------------------------- */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_NOT_VERIFIED: 'ACCOUNT_NOT_VERIFIED',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  INVITE_INVALID: 'INVITE_INVALID',
  INVITE_EXPIRED: 'INVITE_EXPIRED',
  PASSWORD_RESET_INVALID: 'PASSWORD_RESET_INVALID',
  PASSWORD_TOO_WEAK: 'PASSWORD_TOO_WEAK',
  PASSWORD_REUSED: 'PASSWORD_REUSED',

  /* Authorization ---------------------------------------------------------- */
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
  OUTSIDE_CLINIC_SCOPE: 'OUTSIDE_CLINIC_SCOPE',
  CANNOT_ACT_ON_ROLE: 'CANNOT_ACT_ON_ROLE',
  NOT_RESOURCE_OWNER: 'NOT_RESOURCE_OWNER',

  /* Appointments ----------------------------------------------------------- */
  APPOINTMENT_SLOT_TAKEN: 'APPOINTMENT_SLOT_TAKEN',
  APPOINTMENT_SLOT_INVALID: 'APPOINTMENT_SLOT_INVALID',
  APPOINTMENT_SLOT_PAST: 'APPOINTMENT_SLOT_PAST',
  APPOINTMENT_TOO_SOON: 'APPOINTMENT_TOO_SOON',
  APPOINTMENT_TOO_FAR: 'APPOINTMENT_TOO_FAR',
  APPOINTMENT_DOCTOR_UNAVAILABLE: 'APPOINTMENT_DOCTOR_UNAVAILABLE',
  APPOINTMENT_INVALID_TRANSITION: 'APPOINTMENT_INVALID_TRANSITION',
  APPOINTMENT_ALREADY_TERMINAL: 'APPOINTMENT_ALREADY_TERMINAL',
  APPOINTMENT_CANCELLATION_WINDOW_PASSED: 'APPOINTMENT_CANCELLATION_WINDOW_PASSED',
  DOCTOR_NOT_ACCEPTING_PATIENTS: 'DOCTOR_NOT_ACCEPTING_PATIENTS',

  /* Pets ------------------------------------------------------------------- */
  PET_NOT_FOUND: 'PET_NOT_FOUND',
  PET_ARCHIVED: 'PET_ARCHIVED',
  PET_HAS_ACTIVE_APPOINTMENTS: 'PET_HAS_ACTIVE_APPOINTMENTS',
  PET_LIMIT_REACHED: 'PET_LIMIT_REACHED',

  /* Medical ---------------------------------------------------------------- */
  MEDICAL_RECORD_LOCKED: 'MEDICAL_RECORD_LOCKED',
  AMENDMENT_REASON_REQUIRED: 'AMENDMENT_REASON_REQUIRED',
  NOT_TREATING_CLINICIAN: 'NOT_TREATING_CLINICIAN',

  /* Reviews ---------------------------------------------------------------- */
  REVIEW_ALREADY_EXISTS: 'REVIEW_ALREADY_EXISTS',
  REVIEW_REQUIRES_COMPLETED_VISIT: 'REVIEW_REQUIRES_COMPLETED_VISIT',
  REVIEW_WINDOW_PASSED: 'REVIEW_WINDOW_PASSED',
  REVIEW_EDIT_WINDOW_PASSED: 'REVIEW_EDIT_WINDOW_PASSED',

  /* Uploads ---------------------------------------------------------------- */
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  UNSUPPORTED_FILE_TYPE: 'UNSUPPORTED_FILE_TYPE',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',

  /* Users ------------------------------------------------------------------ */
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  CANNOT_DELETE_SELF: 'CANNOT_DELETE_SELF',
  CANNOT_DEMOTE_LAST_SUPER_ADMIN: 'CANNOT_DEMOTE_LAST_SUPER_ADMIN',
  DOCTOR_HAS_UPCOMING_APPOINTMENTS: 'DOCTOR_HAS_UPCOMING_APPOINTMENTS',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Default user-facing copy per code.
 *
 * The server sends a message with every failure, but the client keeps this
 * table so it can localise, or override a message with something more specific
 * to the screen the user is on.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
  VALIDATION_FAILED: 'Please check the highlighted fields and try again.',
  NOT_FOUND: 'We could not find what you were looking for.',
  CONFLICT: 'That change conflicts with the current state. Please refresh.',
  RATE_LIMITED: 'Too many requests. Please wait a moment and try again.',
  PAYLOAD_TOO_LARGE: 'That request was too large.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable. Please try again shortly.',

  UNAUTHENTICATED: 'Please sign in to continue.',
  INVALID_CREDENTIALS: 'That email and password combination is not correct.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
  TOKEN_INVALID: 'Your session is no longer valid. Please sign in again.',
  REFRESH_TOKEN_REUSED: 'For your security we signed you out of all devices.',
  SESSION_REVOKED: 'This session was ended. Please sign in again.',
  ACCOUNT_LOCKED: 'Too many failed attempts. Your account is locked briefly.',
  ACCOUNT_SUSPENDED: 'This account has been suspended. Please contact your clinic.',
  ACCOUNT_NOT_VERIFIED: 'Please verify your email address first.',
  EMAIL_ALREADY_REGISTERED: 'An account with that email already exists.',
  INVITE_INVALID: 'This invitation link is not valid.',
  INVITE_EXPIRED: 'This invitation has expired. Please ask for a new one.',
  PASSWORD_RESET_INVALID: 'This reset link is invalid or has already been used.',
  PASSWORD_TOO_WEAK: 'Please choose a stronger password.',
  PASSWORD_REUSED: 'Please choose a password you have not used before.',

  FORBIDDEN: 'You do not have access to this.',
  INSUFFICIENT_PERMISSION: 'Your role does not allow this action.',
  OUTSIDE_CLINIC_SCOPE: 'That record belongs to a different clinic.',
  CANNOT_ACT_ON_ROLE: 'You cannot perform this action on this user.',
  NOT_RESOURCE_OWNER: 'You can only modify your own records.',

  APPOINTMENT_SLOT_TAKEN: 'That time was just booked by someone else. Please pick another.',
  APPOINTMENT_SLOT_INVALID: 'That time is not a valid appointment slot.',
  APPOINTMENT_SLOT_PAST: 'That time is in the past.',
  APPOINTMENT_TOO_SOON: 'Appointments need more notice than that.',
  APPOINTMENT_TOO_FAR: 'That date is further ahead than bookings are open.',
  APPOINTMENT_DOCTOR_UNAVAILABLE: 'The doctor is not available at that time.',
  APPOINTMENT_INVALID_TRANSITION: 'That status change is not allowed from here.',
  APPOINTMENT_ALREADY_TERMINAL: 'This appointment is already closed.',
  APPOINTMENT_CANCELLATION_WINDOW_PASSED:
    'It is too late to cancel online. Please call the clinic.',
  DOCTOR_NOT_ACCEPTING_PATIENTS: 'This doctor is not accepting new bookings right now.',

  PET_NOT_FOUND: 'We could not find that pet.',
  PET_ARCHIVED: 'That pet has been archived.',
  PET_HAS_ACTIVE_APPOINTMENTS: 'Cancel the upcoming appointments before archiving this pet.',
  PET_LIMIT_REACHED: 'You have reached the maximum number of pets for one account.',

  MEDICAL_RECORD_LOCKED: 'This record is locked. Add an amendment instead.',
  AMENDMENT_REASON_REQUIRED: 'Please give a reason for amending this record.',
  NOT_TREATING_CLINICIAN: 'Only the treating clinician can change this record.',

  REVIEW_ALREADY_EXISTS: 'You have already reviewed this visit.',
  REVIEW_REQUIRES_COMPLETED_VISIT: 'You can review a doctor after a completed visit.',
  REVIEW_WINDOW_PASSED: 'The review window for this visit has closed.',
  REVIEW_EDIT_WINDOW_PASSED: 'Reviews can no longer be edited after this long.',

  UPLOAD_FAILED: 'The upload did not complete. Please try again.',
  UNSUPPORTED_FILE_TYPE: 'That file type is not supported.',
  FILE_TOO_LARGE: 'That file is too large.',

  USER_NOT_FOUND: 'We could not find that user.',
  CANNOT_DELETE_SELF: 'You cannot delete your own account from here.',
  CANNOT_DEMOTE_LAST_SUPER_ADMIN: 'There must always be at least one super admin.',
  DOCTOR_HAS_UPCOMING_APPOINTMENTS:
    'Reassign or cancel this doctor’s upcoming appointments first.',
};

/**
 * Codes the client should react to by refetching rather than by showing a toast.
 * A slot being taken is not really an "error" — it is stale data.
 */
export const REFETCH_ON_ERROR_CODES: readonly ErrorCode[] = [
  ERROR_CODES.APPOINTMENT_SLOT_TAKEN,
  ERROR_CODES.APPOINTMENT_INVALID_TRANSITION,
  ERROR_CODES.APPOINTMENT_ALREADY_TERMINAL,
  ERROR_CODES.CONFLICT,
];

/** Codes that mean the session is gone and the client must return to sign-in. */
export const SESSION_ENDED_ERROR_CODES: readonly ErrorCode[] = [
  ERROR_CODES.UNAUTHENTICATED,
  ERROR_CODES.TOKEN_EXPIRED,
  ERROR_CODES.TOKEN_INVALID,
  ERROR_CODES.SESSION_REVOKED,
  ERROR_CODES.REFRESH_TOKEN_REUSED,
];
