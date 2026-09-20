/**
 * HTTP server lifecycle.
 *
 * The part that matters here is **graceful shutdown**. Platforms like Render
 * and Railway deploy by sending SIGTERM and then killing the process a short
 * while later. A server that exits immediately drops every in-flight request:
 * users see failed saves, and an appointment that was mid-write may or may not
 * have landed. Every deploy becomes a small outage.
 *
 * The sequence below drains properly:
 *
 *   1. Stop accepting new connections.
 *   2. Let in-flight requests finish (bounded — we cannot wait forever).
 *   3. Close the database connection cleanly.
 *   4. Exit.
 *
 * With a hard timeout, because a hung request must not prevent the deploy.
 */

import http from 'node:http';
import type { Express } from 'express';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startScheduledJobs, stopScheduledJobs } from './jobs/index.js';
import { registerProcessErrorHandlers } from './middleware/error-handler.js';
import { warnIfProxyMisconfigured } from './middleware/rate-limit.js';
import { closeSocketServer, createSocketServer } from './realtime/socket-server.js';
import type { TypedServer } from './realtime/emitter.js';

/** How long in-flight requests get to finish before we stop waiting. */
const SHUTDOWN_GRACE_MS = 15_000;

export interface StartedServer {
  server: http.Server;
  shutdown: (reason: string) => Promise<void>;
}

export async function startServer(app: Express): Promise<StartedServer> {
  await connectDatabase();
  warnIfProxyMisconfigured();

  const server = http.createServer(app);

  /* Socket.IO attaches to the same HTTP server, so both share one port. */
  const io: TypedServer | null = createSocketServer(server);

  /**
   * Keep-alive tuning for life behind a load balancer.
   *
   * `keepAliveTimeout` must exceed the proxy's own idle timeout, or the server
   * may close a socket the proxy is about to reuse — which surfaces as
   * sporadic, unreproducible 502s. `headersTimeout` must in turn exceed
   * `keepAliveTimeout`.
   */
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  /* A request that has not completed in two minutes is not going to. */
  server.requestTimeout = 120_000;

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.PORT, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  /* Started only once the server is accepting requests, so a job cannot fire
     against a half-initialised process. */
  startScheduledJobs();

  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      prefix: env.API_PREFIX,
      realtime: io !== null,
      jobs: env.ENABLE_SCHEDULED_JOBS,
    },
    `Pawsitive API listening on port ${env.PORT}`,
  );

  /* Guards against two signals arriving, or a fatal error racing a SIGTERM. */
  let shuttingDown = false;

  async function shutdown(reason: string): Promise<void> {
    if (shuttingDown) {
      logger.warn({ reason }, 'Shutdown already in progress');
      return;
    }

    shuttingDown = true;
    logger.info({ reason }, 'Shutting down gracefully');

    /* A hard deadline. If draining hangs, exit anyway — the platform will kill
       us shortly regardless, and a clean-ish exit beats being SIGKILLed. */
    const forceExit = setTimeout(() => {
      logger.fatal({ reason }, 'Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);

    /* Do not hold the event loop open purely for this timer. */
    forceExit.unref();

    try {
      /**
       * Order matters. Stop *producing* work before stopping the things that
       * consume it:
       *
       *   1. Cron first, so no new job starts mid-shutdown.
       *   2. Sockets next — an open websocket is a live connection that would
       *      otherwise hold `server.close()` open indefinitely.
       *   3. Then drain HTTP, then close the database.
       *
       * Closing the database first would make every in-flight request fail on
       * its next query, which is the opposite of draining gracefully.
       */
      stopScheduledJobs();
      await closeSocketServer(io);

      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        /* Idle keep-alive sockets would otherwise hold `close` open for the
           full keep-alive timeout. */
        server.closeIdleConnections();
      });

      logger.info('HTTP server closed — no requests in flight');

      await disconnectDatabase();

      clearTimeout(forceExit);
      logger.info({ reason }, 'Shutdown complete');
      process.exit(reason === 'uncaughtException' || reason === 'unhandledRejection' ? 1 : 0);
    } catch (error) {
      clearTimeout(forceExit);
      logger.error({ err: error, reason }, 'Error during shutdown');
      process.exit(1);
    }
  }

  /* SIGTERM: the platform is deploying or scaling down. SIGINT: Ctrl-C. */
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  registerProcessErrorHandlers(shutdown);

  return { server, shutdown };
}
