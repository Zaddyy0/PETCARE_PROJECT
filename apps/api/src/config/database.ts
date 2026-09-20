/**
 * MongoDB connection management.
 *
 * The previous implementation called `process.exit(1)` the moment a connection
 * attempt failed. On a platform that restarts crashed containers that produces
 * a crash loop, and a transient Atlas failover — which resolves itself in
 * seconds — becomes an outage plus a pager alert.
 *
 * What we do instead:
 *
 *   • Retry the *initial* connection with exponential backoff and jitter, then
 *     give up loudly. A server that cannot reach its database at boot genuinely
 *     has nothing to serve, so exiting eventually is right; exiting instantly
 *     is not.
 *   • Let Mongoose's own reconnection logic handle drops *after* startup. It
 *     buffers commands and reconnects on its own; killing the process throws
 *     away in-flight requests for no benefit.
 *   • Surface connection state to the health endpoint so the load balancer can
 *     route around a sick instance rather than the instance killing itself.
 */

import mongoose from 'mongoose';
import { env, isProd, isTest } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('database');

let isShuttingDown = false;

export interface ConnectOptions {
  uri?: string;
  maxAttempts?: number;
}

/**
 * Connect, retrying with exponential backoff and full jitter.
 *
 * Jitter matters when several instances boot at once after a deploy: without
 * it they retry in lockstep and hammer a recovering cluster in synchronised
 * waves.
 */
export async function connectDatabase(options: ConnectOptions = {}): Promise<typeof mongoose> {
  const uri = options.uri ?? env.MONGODB_URI;
  const maxAttempts = options.maxAttempts ?? (isProd ? 8 : 3);

  /* Reject unknown keys instead of silently ignoring a typo'd field, and index
     automatically everywhere but production, where index builds are a deploy
     step rather than a side effect of the first query. */
  mongoose.set('strictQuery', true);
  mongoose.set('autoIndex', !isProd);

  /**
   * `sanitizeFilter` is deliberately NOT enabled.
   *
   * It sounds like free protection, but it wraps *every* object-valued filter
   * in `$eq` — including the query operators we write ourselves. A perfectly
   * ordinary `{ expiresAt: { $gt: new Date() } }` becomes
   * `{ expiresAt: { $eq: { $gt: ... } } }`, which then fails to cast and throws.
   * It silently breaks every date range, every `$in`, and every cursor
   * comparison in the codebase.
   *
   * The injection it defends against — a client sending `{"email": {"$ne": null}}`
   * where a string was expected — is already impossible here, for two reasons
   * that hold independently:
   *
   *   1. Every request body, query and param is parsed by a Zod schema before
   *      a handler sees it. `z.string()` rejects an object outright, and
   *      unknown keys are stripped rather than passed through.
   *   2. No service builds a filter by spreading raw request data. Filters are
   *      assembled field by field from validated values.
   *
   * If a future endpoint ever does need to accept a caller-supplied operator,
   * sanitise that one query with `mongoose.trusted()` rather than turning this
   * global back on.
   */

  registerConnectionListeners();

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;

    try {
      const connection = await mongoose.connect(uri, {
        dbName: env.MONGODB_DB_NAME,
        maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
        minPoolSize: env.MONGODB_MIN_POOL_SIZE,
        /* Fail a command in 10s rather than hanging a request forever. */
        serverSelectionTimeoutMS: 10_000,
        socketTimeoutMS: 45_000,
        /* Reads and writes both go to the primary by default; we only relax
           that for analytics aggregations, which set it per query. */
        retryWrites: true,
        retryReads: true,
        compressors: ['zlib'],
      });

      log.info(
        { database: env.MONGODB_DB_NAME, poolSize: env.MONGODB_MAX_POOL_SIZE, attempt },
        'Connected to MongoDB',
      );

      return connection;
    } catch (error) {
      lastError = error;

      if (attempt >= maxAttempts) break;

      /* Exponential base with full jitter, capped at 30s. */
      const ceiling = Math.min(30_000, 500 * 2 ** attempt);
      const delay = Math.floor(Math.random() * ceiling);

      log.warn(
        { attempt, maxAttempts, retryInMs: delay, err: error },
        'MongoDB connection failed — retrying',
      );

      await sleep(delay);
    }
  }

  log.fatal({ err: lastError, attempts: maxAttempts }, 'Could not reach MongoDB — giving up');
  throw lastError instanceof Error ? lastError : new Error('MongoDB connection failed');
}

function registerConnectionListeners(): void {
  const connection = mongoose.connection;

  /* `removeAllListeners` keeps a reconnect from stacking duplicate handlers. */
  connection.removeAllListeners('disconnected');
  connection.removeAllListeners('reconnected');
  connection.removeAllListeners('error');

  connection.on('error', (error) => {
    log.error({ err: error }, 'MongoDB connection error');
  });

  connection.on('disconnected', () => {
    if (isShuttingDown) return;
    /* Not fatal: the driver reconnects on its own and buffers meanwhile. */
    log.warn('MongoDB disconnected — the driver will keep retrying');
  });

  connection.on('reconnected', () => {
    log.info('MongoDB reconnected');
  });
}

/** Close the connection cleanly. Called from the graceful-shutdown path. */
export async function disconnectDatabase(): Promise<void> {
  isShuttingDown = true;

  if (mongoose.connection.readyState === 0) return;

  try {
    await mongoose.connection.close(false);
    log.info('MongoDB connection closed');
  } catch (error) {
    log.error({ err: error }, 'Error while closing the MongoDB connection');
  }
}

export type DatabaseState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

const READY_STATES: Record<number, DatabaseState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export function getDatabaseState(): DatabaseState {
  return READY_STATES[mongoose.connection.readyState] ?? 'disconnected';
}

/**
 * Round-trip latency to the database, via a `ping` command.
 *
 * The health endpoint uses this so "healthy" means "can actually serve a
 * request" rather than "the process is running" — a check that only reports
 * process liveness will happily keep a database-less instance in rotation.
 */
export async function pingDatabase(): Promise<number | null> {
  if (mongoose.connection.readyState !== 1) return null;

  const startedAt = performance.now();

  try {
    await mongoose.connection.db?.admin().ping();
    return Math.round(performance.now() - startedAt);
  } catch {
    return null;
  }
}

/**
 * Run a function inside a transaction when the deployment supports one.
 *
 * Transactions require a replica set. Atlas provides one on every tier, but a
 * developer's standalone `mongod` does not, and failing hard there would make
 * the project impossible to run locally without extra setup. So we detect the
 * capability once and degrade to a plain call when it is unavailable — which is
 * safe for our uses, because the one place correctness genuinely depends on
 * atomicity (double-booking) is protected by a unique index rather than by a
 * transaction.
 */
let transactionsSupported: boolean | null = null;

export async function withTransaction<T>(
  work: (session: mongoose.ClientSession | undefined) => Promise<T>,
): Promise<T> {
  if (transactionsSupported === null) {
    transactionsSupported = await detectTransactionSupport();

    if (!transactionsSupported && !isTest) {
      log.warn(
        'This MongoDB deployment is standalone, so transactions are unavailable. ' +
          'Multi-document operations will run without atomicity. Use a replica set in production.',
      );
    }
  }

  if (!transactionsSupported) {
    return work(undefined);
  }

  const session = await mongoose.startSession();

  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}

async function detectTransactionSupport(): Promise<boolean> {
  try {
    const info = await mongoose.connection.db?.admin().command({ hello: 1 });
    /* `setName` is present on a replica set member; `msg: 'isdbgrid'` marks a
       sharded cluster. Either supports transactions; a standalone has neither. */
    return Boolean(info?.['setName'] || info?.['msg'] === 'isdbgrid');
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
