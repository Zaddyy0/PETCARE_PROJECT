/**
 * Rate limiting.
 *
 * Two things the previous setup got wrong, both of which matter at scale:
 *
 *   1. **The store was in-process memory.** With two instances behind a load
 *      balancer, each keeps its own counter, so a "10 attempts per 15 minutes"
 *      limit is really 20 — and it resets on every deploy. The Mongo-backed
 *      store below is shared, so the limit means what it says however many
 *      instances are running.
 *
 *   2. **Only `/api/auth` was limited.** Everything else was unbounded.
 *
 * Limits are keyed by user id when the caller is authenticated and by IP
 * otherwise. Keying solely on IP punishes everyone behind one NAT — an office,
 * a university, a mobile carrier — as though they were a single user.
 */

import rateLimit, { type Options, type Store } from 'express-rate-limit';
import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import { ERROR_CODES, RATE_LIMITS, type ApiFailure } from '@pawsitive/shared';
import { env, isTest } from '../config/env.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('rate-limit');

/* -------------------------------------------------------------------------- */
/*                            Shared Mongo store                              */
/* -------------------------------------------------------------------------- */

interface RateLimitRecord {
  _id: string;
  hits: number;
  expiresAt: Date;
}

/**
 * A rate-limit store backed by MongoDB.
 *
 * We already depend on Mongo, so this avoids adding Redis purely for counters.
 * Each increment is a single atomic `findOneAndUpdate` with `$inc` and
 * `$setOnInsert`, so concurrent requests across instances cannot lose a count
 * the way a read-modify-write would.
 *
 * A TTL index lets the server expire old windows itself.
 */
class MongoRateLimitStore implements Store {
  private windowMs = 60_000;
  private collectionName = 'rate_limits';
  private indexReady: Promise<void> | null = null;

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private get collection() {
    const db = mongoose.connection.db;
    if (!db) throw new Error('Database connection is not ready');
    return db.collection<RateLimitRecord>(this.collectionName);
  }

  /** Create the TTL index once, lazily, on first use. */
  private async ensureIndex(): Promise<void> {
    this.indexReady ??= this.collection
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'rate_limit_ttl' })
      .then(() => undefined)
      .catch((error: unknown) => {
        log.error({ err: error }, 'Could not create the rate-limit TTL index');
        /* Reset so a later request retries rather than being stuck. */
        this.indexReady = null;
      });

    return this.indexReady;
  }

  async increment(key: string): Promise<{ totalHits: number; resetTime: Date }> {
    await this.ensureIndex();

    const now = Date.now();
    const resetTime = new Date(now + this.windowMs);

    const result = await this.collection.findOneAndUpdate(
      { _id: key },
      {
        $inc: { hits: 1 },
        /* Only set on insert, so the window is fixed from the first hit rather
           than sliding forward with every request — which would never reset for
           a client that keeps knocking. */
        $setOnInsert: { expiresAt: resetTime },
      },
      { upsert: true, returnDocument: 'after' },
    );

    return {
      totalHits: result?.hits ?? 1,
      resetTime: result?.expiresAt ?? resetTime,
    };
  }

  async decrement(key: string): Promise<void> {
    await this.collection.updateOne({ _id: key, hits: { $gt: 0 } }, { $inc: { hits: -1 } });
  }

  async resetKey(key: string): Promise<void> {
    await this.collection.deleteOne({ _id: key });
  }

  async resetAll(): Promise<void> {
    await this.collection.deleteMany({});
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Factory                                   */
/* -------------------------------------------------------------------------- */

/**
 * Key by authenticated user, falling back to IP.
 *
 * `req.ip` is only trustworthy because `trust proxy` is set to a specific hop
 * count in `app.ts`. With `trust proxy: true` a caller could spoof
 * `X-Forwarded-For` and mint a fresh key per request, bypassing the limit
 * entirely.
 */
function keyGenerator(req: Request): string {
  const userId = req.auth?.userId?.toString();
  if (userId) return `u:${userId}`;

  return `ip:${req.ip ?? 'unknown'}`;
}

function handler(_req: Request, res: Response): void {
  const resetTime = (res.getHeader('RateLimit-Reset') as number | undefined) ?? 60;

  const body: ApiFailure = {
    success: false,
    message: 'Too many requests. Please slow down and try again shortly.',
    code: ERROR_CODES.RATE_LIMITED,
    requestId: (res.locals['requestId'] as string | undefined) ?? 'unknown',
  };

  res.setHeader('Retry-After', String(resetTime));
  res.status(429).json(body);
}

interface LimiterConfig {
  windowMs: number;
  max: number;
  /** Do not count requests that succeeded — used for the auth limiter. */
  skipSuccessfulRequests?: boolean;
}

function createLimiter(name: string, config: LimiterConfig) {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.max,
    /* Standard `RateLimit-*` headers; the legacy `X-RateLimit-*` ones are
       deprecated and just add bytes. */
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `${name}:${keyGenerator(req as Request)}`,
    handler,
    skipSuccessfulRequests: config.skipSuccessfulRequests ?? false,
    /* Tests would otherwise trip limits and fail for unrelated reasons. */
    skip: () => isTest,
    store: isTest ? undefined : new MongoRateLimitStore(),
  });
}

/* -------------------------------------------------------------------------- */
/*                                  Limiters                                  */
/* -------------------------------------------------------------------------- */

/** Broad ceiling on everything. Generous enough that a real user never sees it. */
export const globalLimiter = createLimiter('global', RATE_LIMITS.GLOBAL);

/**
 * Sign-in and registration.
 *
 * `skipSuccessfulRequests` means correct sign-ins do not count toward the
 * limit, so only *failures* accumulate. A legitimate user who signs in ten
 * times today is unaffected; someone making ten wrong guesses is stopped.
 */
export const authLimiter = createLimiter('auth', {
  ...RATE_LIMITS.AUTH,
  skipSuccessfulRequests: true,
});

/** Password reset, invite resend — anything that sends an email. */
export const sensitiveLimiter = createLimiter('sensitive', RATE_LIMITS.SENSITIVE);

/** Writes, which cost more than reads. */
export const mutationLimiter = createLimiter('mutation', RATE_LIMITS.MUTATION);

/** Uploads, which cost more still. */
export const uploadLimiter = createLimiter('upload', RATE_LIMITS.UPLOAD);

export { MongoRateLimitStore };

/**
 * Warn when the proxy configuration would break per-IP limiting.
 *
 * Behind a load balancer with `TRUST_PROXY_HOPS` at 0, every request appears to
 * come from the proxy — so all users share one bucket and the first busy minute
 * locks out the entire platform. Worth saying out loud at boot.
 */
export function warnIfProxyMisconfigured(): void {
  if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === 0) {
    log.warn(
      'TRUST_PROXY_HOPS is 0 in production. If this runs behind a proxy, every ' +
        'client will share a single rate-limit bucket.',
    );
  }
}
