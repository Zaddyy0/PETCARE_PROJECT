/**
 * The central error handler.
 *
 * The previous implementation had a serious flaw:
 *
 *     res.status(statusCode).json({ success: false, message, ... })
 *
 * where `message` fell back to `err.message` for *any* error. A `TypeError`
 * from inside Mongoose, a failed cast, a driver timeout — all of them returned
 * their internal text to the caller. That leaks stack frames, query shapes,
 * collection names and sometimes the data itself, and it is the standard first
 * step of an attack: provoke errors and read what falls out.
 *
 * The rule here is simple and absolute: **a message reaches the client only if
 * we wrote it for the client.** Anything else becomes a generic 500 while the
 * real detail goes to the logs, correlated by request id so it is still one
 * query away for us.
 *
 * The handler also translates the errors our dependencies throw — Zod, Mongoose
 * validation, duplicate keys, malformed JSON, JWT failures, Multer limits — into
 * the same envelope, so a client never has to special-case where a failure
 * originated.
 */

import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { ZodError } from 'zod';
import {
  ERROR_CODES,
  ERROR_MESSAGES,
  type ApiFailure,
  type ErrorCode,
  type FieldError,
} from '@pawsitive/shared';
import { env, isProd } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ApiError } from '../utils/api-error.js';
import { isSlotConflictError } from '../models/appointment.model.js';
import { isDuplicateReviewError } from '../models/review.model.js';

/** 404 for anything that reached the end of the router chain. */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    new ApiError({
      statusCode: 404,
      code: ERROR_CODES.NOT_FOUND,
      message: `No route matches ${req.method} ${req.originalUrl}`,
    }),
  );
}

interface NormalisedError {
  statusCode: number;
  code: ErrorCode;
  message: string;
  errors: FieldError[];
  retryAfterSeconds?: number;
  /** False when the message came from us and is safe to show a user. */
  isUnexpected: boolean;
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  /* Express requires the four-arity signature to recognise this as an error
     handler, and delegates to its default if headers are already sent. */
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalised = normaliseError(error);

  /* Unexpected errors are bugs: log the whole thing, stack included. Expected
     ones are routine and logged at a level that will not page anybody. */
  const logPayload = {
    err: error,
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode: normalised.statusCode,
    code: normalised.code,
    userId: req.auth?.userId?.toString(),
    ...(error instanceof ApiError && error.context ? { context: error.context } : {}),
  };

  if (normalised.isUnexpected || normalised.statusCode >= 500) {
    logger.error(logPayload, 'Unhandled error while serving request');
  } else if (normalised.statusCode >= 400) {
    logger.warn(logPayload, 'Request failed');
  }

  const body: ApiFailure = {
    success: false,
    message: normalised.message,
    code: normalised.code,
    requestId: req.requestId ?? 'unknown',
  };

  if (normalised.errors.length > 0) {
    body.errors = normalised.errors;
  }

  /**
   * Stack traces go out in development only.
   *
   * They are genuinely useful when the frontend and backend are being built
   * together, and they are a map of the codebase when they are not.
   */
  if (!isProd && error instanceof Error && error.stack) {
    body.stack = error.stack;
  }

  if (normalised.retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', String(normalised.retryAfterSeconds));
  }

  res.status(normalised.statusCode).json(body);
}

/* -------------------------------------------------------------------------- */
/*                              Error translation                             */
/* -------------------------------------------------------------------------- */

function normaliseError(error: unknown): NormalisedError {
  /* ---- Our own errors. The only ones whose message is echoed verbatim. --- */
  if (error instanceof ApiError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      errors: error.errors,
      ...(error.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: error.retryAfterSeconds }
        : {}),
      isUnexpected: false,
    };
  }

  /* ---- Zod: a validation failure with per-field detail. ------------------ */
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: ERROR_MESSAGES.VALIDATION_FAILED,
      errors: zodToFieldErrors(error),
      isUnexpected: false,
    };
  }

  /* ---- Mongo duplicate key. --------------------------------------------- */
  if (isMongoDuplicateKey(error)) {
    /* The slot indexes are how double-booking is prevented, so this is the
       expected outcome of losing a booking race — not an anomaly. */
    const slotConflict = isSlotConflictError(error);
    if (slotConflict) {
      return {
        statusCode: 409,
        code: ERROR_CODES.APPOINTMENT_SLOT_TAKEN,
        message:
          slotConflict === 'doctor'
            ? 'That time was just booked by someone else. Please choose another slot.'
            : 'This pet already has an appointment at that time.',
        errors: [],
        isUnexpected: false,
      };
    }

    if (isDuplicateReviewError(error)) {
      return {
        statusCode: 409,
        code: ERROR_CODES.REVIEW_ALREADY_EXISTS,
        message: ERROR_MESSAGES.REVIEW_ALREADY_EXISTS,
        errors: [],
        isUnexpected: false,
      };
    }

    const field = duplicateKeyField(error);

    if (field === 'email') {
      return {
        statusCode: 409,
        code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        message: ERROR_MESSAGES.EMAIL_ALREADY_REGISTERED,
        errors: [{ field: 'email', message: ERROR_MESSAGES.EMAIL_ALREADY_REGISTERED }],
        isUnexpected: false,
      };
    }

    return {
      statusCode: 409,
      code: ERROR_CODES.CONFLICT,
      /* Name the field but never the value — the value may be another user's
         data, and echoing it turns a conflict into an enumeration oracle. */
      message: field
        ? `That ${humanise(field)} is already in use.`
        : ERROR_MESSAGES.CONFLICT,
      errors: field ? [{ field, message: 'Already in use' }] : [],
      isUnexpected: false,
    };
  }

  /* ---- Mongoose schema validation. -------------------------------------- */
  if (error instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: ERROR_MESSAGES.VALIDATION_FAILED,
      errors: Object.values(error.errors).map((issue) => ({
        field: issue.path,
        message: issue.message,
      })),
      isUnexpected: false,
    };
  }

  /* ---- A malformed ObjectId in a path parameter. ------------------------- */
  if (error instanceof mongoose.Error.CastError) {
    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: `The value provided for ${humanise(error.path)} is not valid.`,
      errors: [{ field: error.path, message: 'Invalid value' }],
      isUnexpected: false,
    };
  }

  /* ---- The database is unreachable. Not the client's fault. -------------- */
  if (
    error instanceof mongoose.Error.MongooseServerSelectionError ||
    (error instanceof Error && error.name === 'MongoNetworkError')
  ) {
    return {
      statusCode: 503,
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      message: ERROR_MESSAGES.SERVICE_UNAVAILABLE,
      errors: [],
      retryAfterSeconds: 15,
      /* Unexpected for logging purposes — we want to know — but the message is
         a safe generic one. */
      isUnexpected: true,
    };
  }

  /* ---- JWT problems. ----------------------------------------------------- */
  if (error instanceof jwt.TokenExpiredError) {
    return {
      statusCode: 401,
      code: ERROR_CODES.TOKEN_EXPIRED,
      message: ERROR_MESSAGES.TOKEN_EXPIRED,
      errors: [],
      isUnexpected: false,
    };
  }

  if (error instanceof jwt.JsonWebTokenError) {
    return {
      statusCode: 401,
      code: ERROR_CODES.TOKEN_INVALID,
      message: ERROR_MESSAGES.TOKEN_INVALID,
      errors: [],
      isUnexpected: false,
    };
  }

  /* ---- Body parser: malformed JSON or an oversized payload. -------------- */
  if (isBodyParserError(error)) {
    const status = (error as { status?: number }).status ?? 400;

    if (status === 413) {
      return {
        statusCode: 413,
        code: ERROR_CODES.PAYLOAD_TOO_LARGE,
        message: ERROR_MESSAGES.PAYLOAD_TOO_LARGE,
        errors: [],
        isUnexpected: false,
      };
    }

    return {
      statusCode: 400,
      code: ERROR_CODES.VALIDATION_FAILED,
      message: 'The request body could not be parsed as JSON.',
      errors: [],
      isUnexpected: false,
    };
  }

  /* ---- Multer upload limits. --------------------------------------------- */
  if (error instanceof Error && error.name === 'MulterError') {
    const multerCode = (error as Error & { code?: string }).code;

    if (multerCode === 'LIMIT_FILE_SIZE') {
      return {
        statusCode: 413,
        code: ERROR_CODES.FILE_TOO_LARGE,
        message: ERROR_MESSAGES.FILE_TOO_LARGE,
        errors: [],
        isUnexpected: false,
      };
    }

    return {
      statusCode: 400,
      code: ERROR_CODES.UPLOAD_FAILED,
      message: ERROR_MESSAGES.UPLOAD_FAILED,
      errors: [],
      isUnexpected: false,
    };
  }

  /* ---- Anything else is a bug. ------------------------------------------- *
   *                                                                          *
   * Note what is NOT read here: `error.message`. This is the whole point of   *
   * the file. Whatever it says stays in the logs.                            */
  return {
    statusCode: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    message: ERROR_MESSAGES.INTERNAL_ERROR,
    errors: [],
    isUnexpected: true,
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

/**
 * Flatten a `ZodError` into field errors the UI can attach to inputs.
 *
 * The leading `body` / `query` / `params` segment is dropped so the path
 * matches the form field name the client knows — `email`, not `body.email`.
 */
function zodToFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => {
    const path = issue.path.filter(
      (segment, index) => !(index === 0 && ['body', 'query', 'params'].includes(String(segment))),
    );

    return {
      field: path.join('.') || '_root',
      message: issue.message,
      code: issue.code,
    };
  });
}

function isMongoDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

function duplicateKeyField(error: unknown): string | null {
  const keyPattern = (error as { keyPattern?: Record<string, unknown> }).keyPattern;
  if (keyPattern) {
    const [first] = Object.keys(keyPattern);
    if (first) return first;
  }

  /* Older drivers only put the field in the message text. */
  const match = /index:\s+(\w+)_/.exec((error as { message?: string }).message ?? '');
  return match?.[1] ?? null;
}

function isBodyParserError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    'body' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}

/** `insurancePolicyNumber` → `insurance policy number`. */
function humanise(field: string): string {
  return field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .toLowerCase();
}

/* -------------------------------------------------------------------------- */
/*                         Process-level safety nets                          */
/* -------------------------------------------------------------------------- */

/**
 * Last-resort handlers for errors that escaped every request.
 *
 * An unhandled rejection or uncaught exception leaves the process in an
 * unknown state — some invariant has already been violated. The correct
 * response is to log it, stop accepting new work, finish what is in flight and
 * exit so the platform starts a clean instance. Staying up and pretending
 * otherwise serves corrupt results.
 *
 * `onFatal` is the graceful-shutdown routine, so in-flight requests still get
 * a response.
 */
export function registerProcessErrorHandlers(onFatal: (reason: string) => Promise<void>): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'Unhandled promise rejection — shutting down');
    void onFatal('unhandledRejection');
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception — shutting down');
    void onFatal('uncaughtException');
  });

  process.on('warning', (warning) => {
    /* Surfaces things like a MaxListenersExceededWarning, which is usually a
       leak that would otherwise only show up as slow memory growth. */
    logger.warn({ warning: warning.message, name: warning.name }, 'Node warning');
  });

  if (env.NODE_ENV !== 'production') {
    process.on('multipleResolves', () => {
      /* Noisy and usually harmless; ignored deliberately rather than by
         omission, so nobody adds a handler for it later and wonders why. */
    });
  }
}
