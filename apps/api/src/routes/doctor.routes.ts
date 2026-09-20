import { Router } from 'express';
import {
  createDoctorSchema,
  doctorListQuerySchema,
  idParamSchema,
  slotQuerySchema,
  updateAvailabilitySchema,
  updateDoctorSchema,
} from '@pawsitive/shared';
import * as doctorController from '../controllers/doctor.controller.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../middleware/authorize.js';
import { mutationLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

/* ------------------------------ Public reads ---------------------------- */

/**
 * The directory and slot grid are readable without a session.
 *
 * Someone evaluating the service should be able to see which vets are
 * available before creating an account. `optionalAuthenticate` still attaches
 * identity when a token is present, so staff get a clinic-scoped list from the
 * same endpoint.
 */
router.get(
  '/',
  optionalAuthenticate,
  validate({ query: doctorListQuerySchema }),
  doctorController.list,
);

router.get(
  '/:id',
  optionalAuthenticate,
  validate({ params: idParamSchema }),
  doctorController.getOne,
);

router.get(
  '/:id/slots',
  optionalAuthenticate,
  validate({ params: idParamSchema, query: slotQuerySchema }),
  doctorController.slots,
);

/* ------------------------------- Management ----------------------------- */

router.post(
  '/',
  authenticate,
  requirePermission('doctor:create'),
  mutationLimiter,
  validate({ body: createDoctorSchema }),
  doctorController.create,
);

router.patch(
  '/:id',
  authenticate,
  requireAnyPermission('doctor:update:own', 'doctor:update:any'),
  mutationLimiter,
  validate({ params: idParamSchema, body: updateDoctorSchema }),
  doctorController.update,
);

router.put(
  '/:id/availability',
  authenticate,
  requireAnyPermission('doctor:availability:own', 'doctor:availability:any'),
  mutationLimiter,
  validate({ params: idParamSchema, body: updateAvailabilitySchema }),
  doctorController.updateAvailability,
);

router.delete(
  '/:id',
  authenticate,
  requirePermission('doctor:update:any'),
  mutationLimiter,
  validate({ params: idParamSchema }),
  doctorController.deactivate,
);

export default router;
