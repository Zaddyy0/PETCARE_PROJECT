/**
 * Express application assembly.
 *
 * Middleware order is not cosmetic — several of these are only effective in the
 * right position, and the comments say which. The app is built by a factory
 * rather than as a module singleton so tests can construct an isolated instance
 * per suite without a live server or a shared port.
 */

import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import hpp from 'hpp';
import { ERROR_CODES } from '@pawsitive/shared';
import { env, isProd } from './config/env.js';
import { ApiError } from './utils/api-error.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { globalLimiter } from './middleware/rate-limit.js';
import { maybeHttpLogger, requestContext } from './middleware/request-context.js';
import healthRoutes from './routes/health.routes.js';
import apiRoutes from './routes/index.js';

export function createApp(): Express {
  const app = express();

  /* ---------------------------------------------------------------------- */
  /*  1. Proxy trust — must come first.                                      */
  /*                                                                         */
  /*  Everything that reads `req.ip` (rate limiting, audit logging) depends   */
  /*  on this. A hop *count* rather than `true`: trusting the whole           */
  /*  X-Forwarded-For chain lets a caller prepend a fake IP and bypass        */
  /*  per-IP limits entirely.                                                */
  /* ---------------------------------------------------------------------- */
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  /* Removes the `X-Powered-By: Express` banner — free reconnaissance. */
  app.disable('x-powered-by');

  /* ---------------------------------------------------------------------- */
  /*  2. Request identity — before logging, so every line carries the id.    */
  /* ---------------------------------------------------------------------- */
  app.use(requestContext);
  app.use(maybeHttpLogger);

  /* ---------------------------------------------------------------------- */
  /*  3. Security headers.                                                   */
  /* ---------------------------------------------------------------------- */
  app.use(
    helmet({
      /**
       * The API serves JSON, not HTML, so a restrictive CSP costs nothing here
       * and blocks any attempt to render an injected response as a document.
       */
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      /* Images are served from Cloudinary's CDN, cross-origin by design. */
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      /* Two years of HSTS, in production only — locking a dev machine into
         HTTPS for localhost is a bad afternoon. */
      hsts: isProd ? { maxAge: 63_072_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  /* ---------------------------------------------------------------------- */
  /*  4. CORS.                                                               */
  /*                                                                         */
  /*  `credentials: true`, because the refresh token rides in a cookie. That  */
  /*  makes the origin allowlist load-bearing: with credentials enabled the   */
  /*  spec forbids `*`, and echoing an arbitrary Origin back would let any    */
  /*  site make authenticated calls on a signed-in user's behalf.             */
  /* ---------------------------------------------------------------------- */
  const corsOptions: CorsOptions = {
    origin(origin, callback) {
      /* No Origin header: same-origin, curl, or a mobile client. Allowed —
         CORS protects browsers, and a browser always sends one. */
      if (!origin) {
        callback(null, true);
        return;
      }

      if (env.CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      /**
       * An `ApiError`, not a bare `Error`.
       *
       * `cors` passes whatever it is given to `next()`. A plain Error would
       * fall through to the "this is a bug" branch of the error handler and be
       * reported as a 500 — misleading for the caller, and logged at `error`
       * level, so a bot probing from random origins would page somebody.
       */
      callback(
        new ApiError({
          statusCode: 403,
          code: ERROR_CODES.FORBIDDEN,
          message: 'This origin is not allowed to call the API.',
          context: { origin },
        }),
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 86_400,
  };

  app.use(cors(corsOptions));

  /* ---------------------------------------------------------------------- */
  /*  5. Body parsing.                                                       */
  /*                                                                         */
  /*  1MB is ample for JSON: the only large payloads are file uploads, which  */
  /*  go through multipart handling with its own limit. An unbounded body     */
  /*  parser is a trivial memory-exhaustion vector.                           */
  /* ---------------------------------------------------------------------- */
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  /**
   * HTTP Parameter Pollution.
   *
   * `?role=client&role=super_admin` makes Express produce an *array*, and code
   * written expecting a string then behaves unpredictably — sometimes in a
   * comparison that grants access. `hpp` collapses duplicates to the last
   * value. Must run after the body parsers, since it cleans their output.
   */
  app.use(hpp());

  app.use(compression());

  /* ---------------------------------------------------------------------- */
  /*  6. Health checks — before the rate limiter.                            */
  /*                                                                         */
  /*  A platform prober hits these every few seconds; counting them would    */
  /*  exhaust the limit and make the instance look unhealthy under load,     */
  /*  which is exactly backwards.                                            */
  /* ---------------------------------------------------------------------- */
  app.use('/', healthRoutes);

  /* ---------------------------------------------------------------------- */
  /*  7. Global rate limit, then the API itself.                             */
  /* ---------------------------------------------------------------------- */
  app.use(globalLimiter);

  app.use(env.API_PREFIX, apiRoutes);

  /* ---------------------------------------------------------------------- */
  /*  8. Fallbacks — always last, and in this order.                         */
  /* ---------------------------------------------------------------------- */
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
