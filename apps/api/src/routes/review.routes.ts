import { Router } from 'express';
import {
  idParamSchema,
  moderateReviewSchema,
  objectIdSchema,
  respondToReviewSchema,
  reviewListQuerySchema,
  createReviewSchema,
  updateReviewSchema,
} from '@pawsitive/shared';
import { z } from 'zod';
import * as reviewController from '../controllers/review.controller.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { requirePermission } from '../middleware/authorize.js';
import { mutationLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

/* ------------------------------ Public reads ---------------------------- */

/**
 * `optionalAuthenticate`, not `authenticate`.
 *
 * Reviews are public — they are most of the reason someone chooses a vet. The
 * identity is still attached when present, because the service uses it to set
 * `isOwn` and `canEdit`, and to reveal a signed-in author their own anonymous
 * review.
 */
router.get(
  '/',
  optionalAuthenticate,
  validate({ query: reviewListQuerySchema }),
  reviewController.list,
);

router.get(
  '/summary/:doctorId',
  optionalAuthenticate,
  validate({ params: z.object({ doctorId: objectIdSchema }) }),
  reviewController.summary,
);

/* ------------------------------ Authenticated --------------------------- */

router.post(
  '/',
  authenticate,
  requirePermission('review:create'),
  mutationLimiter,
  validate({ body: createReviewSchema }),
  reviewController.create,
);

router.patch(
  '/:id',
  authenticate,
  requirePermission('review:update:own'),
  mutationLimiter,
  validate({ params: idParamSchema, body: updateReviewSchema }),
  reviewController.update,
);

router.delete(
  '/:id',
  authenticate,
  requirePermission('review:delete:own'),
  mutationLimiter,
  validate({ params: idParamSchema }),
  reviewController.remove,
);

router.post(
  '/:id/helpful',
  authenticate,
  mutationLimiter,
  validate({ params: idParamSchema }),
  reviewController.markHelpful,
);

/**
 * A doctor's public reply.
 *
 * Gated only on being a doctor at route level; the service confirms they are
 * the *reviewed* doctor, which the route cannot know.
 */
router.post(
  '/:id/respond',
  authenticate,
  requirePermission('doctor:update:own'),
  mutationLimiter,
  validate({ params: idParamSchema, body: respondToReviewSchema }),
  reviewController.respond,
);

router.patch(
  '/:id/moderate',
  authenticate,
  requirePermission('review:moderate'),
  mutationLimiter,
  validate({ params: idParamSchema, body: moderateReviewSchema }),
  reviewController.moderate,
);

export default router;
