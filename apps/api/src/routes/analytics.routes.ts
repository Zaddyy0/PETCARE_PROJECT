import { Router } from 'express';
import { analyticsQuerySchema } from '@pawsitive/shared';
import * as analyticsController from '../controllers/analytics.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

router.use(authenticate);

/**
 * Deliberately no `requirePermission`.
 *
 * The service resolves the widest scope the caller's permissions allow and
 * builds that dashboard — a client gets their own summary, a doctor gets theirs,
 * an admin gets the clinic's, a super admin gets the platform's. Gating the
 * route on `analytics:read:own` would lock clients out of their own dashboard,
 * since they hold no analytics permission at all.
 */
router.get(
  '/dashboard',
  validate({ query: analyticsQuerySchema }),
  analyticsController.dashboard,
);

export default router;
