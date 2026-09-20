/**
 * User administration routes.
 *
 * Note the split between `/me` and `/:id`. Self-service and administration are
 * separate endpoints on purpose: a single `PATCH /users/:id` that special-cased
 * "unless it's you" is how a user ends up able to set their own role, because
 * the two paths have genuinely different rules about which fields are writable.
 */

import { Router } from 'express';
import {
  changeRoleSchema,
  createUserSchema,
  idParamSchema,
  suspendUserSchema,
  updateProfileSchema,
  updateUserSchema,
  userListQuerySchema,
} from '@pawsitive/shared';
import * as userController from '../controllers/user.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../middleware/authorize.js';
import { mutationLimiter, sensitiveLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

router.use(authenticate);

/* ------------------------------ Self-service ---------------------------- */

/* Declared before `/:id` so "me" is never parsed as an object id. */
router.patch(
  '/me',
  requirePermission('user:update:own'),
  mutationLimiter,
  validate({ body: updateProfileSchema }),
  userController.updateOwnProfile,
);

router.get('/clinics', userController.listClinics);

/* ----------------------------- Administration --------------------------- */

router.get(
  '/',
  requireAnyPermission('user:read:clinic', 'user:read:any'),
  validate({ query: userListQuerySchema }),
  userController.list,
);

router.get(
  '/:id',
  requireAnyPermission('user:read:clinic', 'user:read:any'),
  validate({ params: idParamSchema }),
  userController.getOne,
);

router.post(
  '/',
  requirePermission('user:create'),
  mutationLimiter,
  validate({ body: createUserSchema }),
  userController.create,
);

router.patch(
  '/:id',
  requirePermission('user:update:any'),
  mutationLimiter,
  validate({ params: idParamSchema, body: updateUserSchema }),
  userController.update,
);

/**
 * Role changes are gated on `user:change_role`, which only a super admin holds.
 * An admin managing their clinic cannot promote anyone — including themselves.
 */
router.patch(
  '/:id/role',
  requirePermission('user:change_role'),
  sensitiveLimiter,
  validate({ params: idParamSchema, body: changeRoleSchema }),
  userController.changeRole,
);

router.post(
  '/:id/suspend',
  requirePermission('user:suspend'),
  mutationLimiter,
  validate({ params: idParamSchema, body: suspendUserSchema }),
  userController.suspend,
);

router.post(
  '/:id/reactivate',
  requirePermission('user:suspend'),
  mutationLimiter,
  validate({ params: idParamSchema }),
  userController.reactivate,
);

router.post(
  '/:id/resend-invite',
  requirePermission('user:create'),
  sensitiveLimiter,
  validate({ params: idParamSchema }),
  userController.resendInvite,
);

export default router;
