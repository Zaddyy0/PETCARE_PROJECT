/**
 * Structured logging.
 *
 * The previous implementation used `console.log`, which produces unparseable
 * prose: you cannot filter it, correlate it, or alert on it. Pino emits one
 * JSON object per line, which every log platform (Render, Railway, Datadog,
 * CloudWatch) indexes natively, while staying human-readable in development
 * through `pino-pretty`.
 *
 * The redaction list below is the important part. Logging is the most common
 * way credentials end up on disk — somebody logs a whole request body while
 * debugging, ships it, and now every password typed on the site is in the log
 * aggregator. Redaction is configured centrally so that cannot happen by
 * accident.
 */

import pino, { type LoggerOptions } from 'pino';
import { env, isProd, isTest } from './env.js';

/**
 * Paths scrubbed from every log line, at any depth we might realistically log.
 *
 * Deliberately broad — the cost of redacting a field that was harmless is zero,
 * the cost of missing one is a credential leak.
 */
const REDACTED_PATHS = [
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'cookie',
  'secret',
  'apiKey',

  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.token',
  'req.body.refreshToken',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers["set-cookie"]',

  'user.passwordHash',
  'user.passwordHistory',
  '*.password',
  '*.passwordHash',
  '*.refreshToken',
];

const options: LoggerOptions = {
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: REDACTED_PATHS,
    censor: '[redacted]',
  },
  /* `level: "info"` reads better in log platforms than `level: 30`. */
  formatters: {
    level: (label) => ({ level: label }),
  },
  base: {
    service: 'pawsitive-api',
    env: env.NODE_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

/* Pretty output locally; raw JSON in production, where a machine reads it. */
const transport =
  env.LOG_PRETTY && !isProd
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname,service,env',
          singleLine: false,
        },
      }
    : undefined;

export const logger = transport ? pino({ ...options, transport }) : pino(options);

/**
 * A child logger tagged with a subsystem name.
 *
 * `createLogger('booking')` stamps `module: "booking"` on every line, so one
 * subsystem's output can be isolated without grepping for message text.
 */
export function createLogger(module: string) {
  return logger.child({ module });
}

export type Logger = typeof logger;
