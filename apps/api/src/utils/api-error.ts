/**
 * The application error type.
 *
 * Two properties make this different from throwing `new Error('nope')`:
 *
 *   • `code` — a stable token from the shared catalogue, so the client can
 *     branch on *what went wrong* rather than parsing English.
 *   • `isOperational` — whether this error was anticipated.
 *
 * That second flag is the one that matters. An *operational* error is a
 * foreseeable outcome: the slot was taken, the password was wrong, the pet does
 * not exist. Its message is written for a user and is safe to return verbatim.
 * A *programmer* error is a bug — a null dereference, a bad query, a failed
 * assertion — and its message is written for us. Returning the latter to a
 * client leaks stack frames, driver internals and query shapes.
 *
 * The old error handler could not tell them apart: it returned `err.message`
 * for anything with no status code, so a `TypeError` from deep inside Mongoose
 * went straight out over HTTP. Here, only errors explicitly constructed as
 * operational have their message forwarded; everything else becomes a generic
 * 500 while the real detail goes to the logs.
 */

import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode, type FieldError } from '@pawsitive/shared';

export interface ApiErrorOptions {
  statusCode?: number;
  code?: ErrorCode;
  message?: string;
  errors?: FieldError[];
  /** The underlying error, kept for logs and never serialised to the client. */
  cause?: unknown;
  /** Extra context for the log line — ids, not payloads. */
  context?: Record<string, unknown>;
  /** Seconds to wait, surfaced as a `Retry-After` header on 429 and 503. */
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly errors: FieldError[];
  readonly context: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | undefined;
  /** Always true on this class. The handler checks it before echoing a message. */
  readonly isOperational = true;

  constructor(options: ApiErrorOptions = {}) {
    const code = options.code ?? ERROR_CODES.INTERNAL_ERROR;
    /* Falling back to the catalogue keeps copy consistent without every call
       site restating it. */
    super(options.message ?? ERROR_MESSAGES[code]);

    this.name = 'ApiError';
    this.statusCode = options.statusCode ?? statusForCode(code);
    this.code = code;
    this.errors = options.errors ?? [];
    this.context = options.context;
    this.retryAfterSeconds = options.retryAfterSeconds;

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }

    Error.captureStackTrace(this, ApiError);
  }

  /* ---------------------------------------------------------------------- */
  /*  Named constructors. Shorter at the call site and impossible to pair a   */
  /*  400 with a "not found" code by accident.                               */
  /* ---------------------------------------------------------------------- */

  static badRequest(code: ErrorCode = ERROR_CODES.VALIDATION_FAILED, message?: string): ApiError {
    return new ApiError({ statusCode: 400, code, ...(message ? { message } : {}) });
  }

  static validation(errors: FieldError[], message?: string): ApiError {
    return new ApiError({
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      errors,
      ...(message ? { message } : {}),
    });
  }

  static unauthorized(
    code: ErrorCode = ERROR_CODES.UNAUTHENTICATED,
    message?: string,
  ): ApiError {
    return new ApiError({ statusCode: 401, code, ...(message ? { message } : {}) });
  }

  static forbidden(code: ErrorCode = ERROR_CODES.FORBIDDEN, message?: string): ApiError {
    return new ApiError({ statusCode: 403, code, ...(message ? { message } : {}) });
  }

  static notFound(code: ErrorCode = ERROR_CODES.NOT_FOUND, message?: string): ApiError {
    return new ApiError({ statusCode: 404, code, ...(message ? { message } : {}) });
  }

  static conflict(code: ErrorCode = ERROR_CODES.CONFLICT, message?: string): ApiError {
    return new ApiError({ statusCode: 409, code, ...(message ? { message } : {}) });
  }

  static tooManyRequests(retryAfterSeconds?: number): ApiError {
    return new ApiError({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  }

  static internal(message?: string, cause?: unknown): ApiError {
    return new ApiError({
      statusCode: 500,
      code: ERROR_CODES.INTERNAL_ERROR,
      ...(message ? { message } : {}),
      cause,
    });
  }

  static serviceUnavailable(retryAfterSeconds = 30): ApiError {
    return new ApiError({
      statusCode: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      retryAfterSeconds,
    });
  }
}

/**
 * The conventional HTTP status for each error code.
 *
 * Having one mapping means a code cannot be returned as a 400 from one route
 * and a 409 from another, which is the sort of inconsistency that forces
 * clients to special-case endpoints.
 */
const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  [ERROR_CODES.VALIDATION_FAILED]: 400,
  [ERROR_CODES.PASSWORD_TOO_WEAK]: 400,
  [ERROR_CODES.PASSWORD_REUSED]: 400,
  [ERROR_CODES.APPOINTMENT_SLOT_INVALID]: 400,
  [ERROR_CODES.APPOINTMENT_SLOT_PAST]: 400,
  [ERROR_CODES.APPOINTMENT_TOO_SOON]: 400,
  [ERROR_CODES.APPOINTMENT_TOO_FAR]: 400,
  [ERROR_CODES.AMENDMENT_REASON_REQUIRED]: 400,
  [ERROR_CODES.UNSUPPORTED_FILE_TYPE]: 400,

  [ERROR_CODES.UNAUTHENTICATED]: 401,
  [ERROR_CODES.INVALID_CREDENTIALS]: 401,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.TOKEN_INVALID]: 401,
  [ERROR_CODES.REFRESH_TOKEN_REUSED]: 401,
  [ERROR_CODES.SESSION_REVOKED]: 401,
  [ERROR_CODES.ACCOUNT_NOT_VERIFIED]: 401,

  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.INSUFFICIENT_PERMISSION]: 403,
  [ERROR_CODES.OUTSIDE_CLINIC_SCOPE]: 403,
  [ERROR_CODES.CANNOT_ACT_ON_ROLE]: 403,
  [ERROR_CODES.NOT_RESOURCE_OWNER]: 403,
  [ERROR_CODES.ACCOUNT_SUSPENDED]: 403,
  [ERROR_CODES.ACCOUNT_LOCKED]: 403,
  [ERROR_CODES.NOT_TREATING_CLINICIAN]: 403,
  [ERROR_CODES.MEDICAL_RECORD_LOCKED]: 403,
  [ERROR_CODES.REVIEW_WINDOW_PASSED]: 403,
  [ERROR_CODES.REVIEW_EDIT_WINDOW_PASSED]: 403,
  [ERROR_CODES.APPOINTMENT_CANCELLATION_WINDOW_PASSED]: 403,

  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.USER_NOT_FOUND]: 404,
  [ERROR_CODES.PET_NOT_FOUND]: 404,

  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.EMAIL_ALREADY_REGISTERED]: 409,
  [ERROR_CODES.APPOINTMENT_SLOT_TAKEN]: 409,
  [ERROR_CODES.APPOINTMENT_INVALID_TRANSITION]: 409,
  [ERROR_CODES.APPOINTMENT_ALREADY_TERMINAL]: 409,
  [ERROR_CODES.REVIEW_ALREADY_EXISTS]: 409,
  [ERROR_CODES.PET_HAS_ACTIVE_APPOINTMENTS]: 409,
  [ERROR_CODES.DOCTOR_HAS_UPCOMING_APPOINTMENTS]: 409,
  [ERROR_CODES.CANNOT_DEMOTE_LAST_SUPER_ADMIN]: 409,

  [ERROR_CODES.PAYLOAD_TOO_LARGE]: 413,
  [ERROR_CODES.FILE_TOO_LARGE]: 413,
  [ERROR_CODES.PET_LIMIT_REACHED]: 422,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/**
 * Is this something we anticipated, or a bug?
 *
 * Only `ApiError` counts. Everything else — including errors thrown by
 * libraries with a convenient-looking `statusCode` property — is treated as a
 * bug, logged in full, and reported to the client as a bare 500.
 */
export function isOperationalError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.isOperational;
}
