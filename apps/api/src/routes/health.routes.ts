/**
 * Health and readiness endpoints.
 *
 * The previous health check returned `{ success: true }` unconditionally — it
 * proved the Node process was running and nothing else. An instance whose
 * database connection had dropped would keep reporting healthy and keep
 * receiving traffic, which is precisely the case a health check exists to
 * catch.
 *
 * Three endpoints, because orchestrators ask three different questions:
 *
 *   • `/health`  — liveness.  "Is this process wedged? Should you restart it?"
 *   • `/ready`   — readiness. "Can this instance serve a request right now?"
 *   • `/metrics` — a small operational summary for the super admin dashboard.
 *
 * Conflating liveness and readiness is a classic outage amplifier: a brief
 * database blip makes every instance fail its *liveness* probe, so the
 * orchestrator restarts them all at once, and now there is a real outage.
 * Liveness stays deliberately dumb.
 */

import { Router } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { getDatabaseState, pingDatabase } from '../config/database.js';
import { sendSuccess } from '../utils/api-response.js';
import { asyncHandler } from '../utils/async-handler.js';

const router: Router = Router();

const startedAt = Date.now();

/**
 * Liveness. Always 200 if the event loop can answer.
 *
 * Deliberately touches nothing external, so a dependency being down never
 * causes a restart loop.
 */
router.get('/health', (_req, res) => {
  res.status(200).json({
    success: true,
    status: 'alive',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  });
});

/**
 * Readiness. 503 when this instance cannot serve traffic.
 *
 * The load balancer pulls it out of rotation on a 503 without killing it, so it
 * can rejoin once the database recovers.
 */
router.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const databaseState = getDatabaseState();
    const latencyMs = await pingDatabase();

    const ready = databaseState === 'connected' && latencyMs !== null;

    res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? 'ready' : 'not_ready',
      checks: {
        database: {
          state: databaseState,
          latencyMs,
          ok: ready,
        },
      },
    });
  }),
);

/**
 * Operational summary.
 *
 * Feeds the `SystemHealth` tile on the super admin dashboard. Mounted behind
 * authentication in `app.ts` — memory figures and connection counts are
 * reconnaissance for anyone else.
 */
router.get(
  '/metrics',
  asyncHandler(async (_req, res) => {
    const memory = process.memoryUsage();
    const latencyMs = await pingDatabase();

    sendSuccess(
      res,
      {
        status: latencyMs !== null ? 'healthy' : 'degraded',
        uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
        databaseStatus: getDatabaseState(),
        databaseLatencyMs: latencyMs,
        /* Resident set size is the honest number — heap alone hides buffers. */
        memoryUsedMb: Math.round(memory.rss / 1024 / 1024),
        memoryTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
        activeSocketConnections: 0,
        connectionPool: {
          max: env.MONGODB_MAX_POOL_SIZE,
          state: mongoose.connection.readyState,
        },
        version: process.env['npm_package_version'] ?? '1.0.0',
        environment: env.NODE_ENV,
        nodeVersion: process.version,
      },
      'System metrics',
    );
  }),
);

export default router;
export { startedAt as processStartedAt };
