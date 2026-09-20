/**
 * Request correlation and HTTP logging.
 *
 * Every request gets an id, which travels through the logs, into the response
 * body and back to the user. When somebody reports "it said something went
 * wrong", that id turns an unreproducible complaint into a single log query.
 */

import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
/* Named import, not default: `pino-http` is CommonJS, so under NodeNext
   resolution the default import binds to the module namespace object rather
   than the callable. The package exports `pinoHttp` by name for this case. */
import { pinoHttp } from 'pino-http';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Attach a request id.
 *
 * An inbound `x-request-id` is honoured so a trace started at the load balancer
 * or in the web client carries through — but it is length-capped and stripped
 * of anything unusual first. An unvalidated header value ends up in log lines
 * and response headers, which is a log-injection and header-splitting vector.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get(REQUEST_ID_HEADER);
  const sanitised = inbound?.replace(/[^\w-]/g, '').slice(0, 64);

  req.requestId = sanitised && sanitised.length >= 8 ? sanitised : randomUUID();
  /* Response locals is where `sendSuccess` and the error handler read it from,
     so no controller has to pass it explicitly. */
  res.locals['requestId'] = req.requestId;
  res.setHeader(REQUEST_ID_HEADER, req.requestId);

  next();
}

/**
 * Structured HTTP access logging.
 *
 * Log level is derived from the outcome: client mistakes are `warn`, server
 * faults are `error`, everything else is `info`. Without this every 404 looks
 * as alarming as every 500, and real incidents drown in routine noise.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).requestId ?? randomUUID(),
  autoLogging: {
    /* Health checks fire every few seconds from the platform's prober and
       would otherwise dominate the log volume. */
    ignore: (req) => req.url === '/health' || req.url === '/api/health',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} ${res.statusCode} — ${err.message}`,
  /* Keep the line small: the full header and body dumps pino-http emits by
     default are enormous and mostly noise. */
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});

/** Disable access logging entirely when `ENABLE_REQUEST_LOGGING` is off. */
export const maybeHttpLogger = env.ENABLE_REQUEST_LOGGING
  ? httpLogger
  : (_req: Request, _res: Response, next: NextFunction) => next();
