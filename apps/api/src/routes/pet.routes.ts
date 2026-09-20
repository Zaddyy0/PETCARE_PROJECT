/**
 * Pet routes.
 *
 * Note the split between `pet:read:own` and `pet:read:clinic` — the route only
 * checks that the caller holds *some* read capability, and the service decides
 * which rows that reaches. Encoding the scope in the route as well would mean
 * two places to keep in sync.
 */

import { Router } from 'express';
import {
  archivePetSchema,
  createPetSchema,
  idParamSchema,
  petListQuerySchema,
  updatePetSchema,
} from '@pawsitive/shared';
import * as petController from '../controllers/pet.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../middleware/authorize.js';
import { mutationLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

/* Every pet route requires a session — there is no public view of a pet. */
router.use(authenticate);

router.get(
  '/',
  requireAnyPermission('pet:read:own', 'pet:read:clinic', 'pet:read:any'),
  validate({ query: petListQuerySchema }),
  petController.list,
);

router.get(
  '/:id',
  requireAnyPermission('pet:read:own', 'pet:read:clinic', 'pet:read:any'),
  validate({ params: idParamSchema }),
  petController.getOne,
);

router.post(
  '/',
  requirePermission('pet:create'),
  mutationLimiter,
  validate({ body: createPetSchema }),
  petController.create,
);

router.patch(
  '/:id',
  requireAnyPermission('pet:update:own', 'pet:update:any'),
  mutationLimiter,
  validate({ params: idParamSchema, body: updatePetSchema }),
  petController.update,
);

router.delete(
  '/:id',
  requireAnyPermission('pet:delete:own', 'pet:delete:any'),
  mutationLimiter,
  validate({ params: idParamSchema, body: archivePetSchema }),
  petController.archive,
);

router.post(
  '/:id/restore',
  requireAnyPermission('pet:update:own', 'pet:update:any'),
  mutationLimiter,
  validate({ params: idParamSchema }),
  petController.restore,
);

export default router;
