import { Router } from 'express';
import {
  appointmentListQuerySchema,
  calendarQuerySchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  idParamSchema,
  rescheduleAppointmentSchema,
  transitionAppointmentSchema,
} from '@pawsitive/shared';
import * as appointmentController from '../controllers/appointment.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../middleware/authorize.js';
import { mutationLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

router.use(authenticate);

const canRead = requireAnyPermission(
  'appointment:read:own',
  'appointment:read:clinic',
  'appointment:read:any',
);

router.get('/', canRead, validate({ query: appointmentListQuerySchema }), appointmentController.list);

/**
 * Mounted before `/:id` deliberately.
 *
 * Express matches in declaration order, so a `/calendar` route declared after
 * `/:id` would never be reached — the parameterised route would capture it and
 * the handler would try to load an appointment with the id "calendar".
 */
router.get(
  '/calendar',
  canRead,
  validate({ query: calendarQuerySchema }),
  appointmentController.calendar,
);

router.get('/:id', canRead, validate({ params: idParamSchema }), appointmentController.getOne);

router.post(
  '/',
  requirePermission('appointment:create'),
  mutationLimiter,
  validate({ body: createAppointmentSchema }),
  appointmentController.book,
);

router.patch(
  '/:id/reschedule',
  requireAnyPermission('appointment:reschedule:own', 'appointment:reschedule:any'),
  mutationLimiter,
  validate({ params: idParamSchema, body: rescheduleAppointmentSchema }),
  appointmentController.reschedule,
);

/**
 * Confirm / start / complete / no-show.
 *
 * Gated on `appointment:transition`, which clients do not hold — they cancel
 * through the route below instead. The service re-checks the specific
 * transition against the state machine, so holding the permission is necessary
 * but not sufficient.
 */
router.patch(
  '/:id/status',
  requirePermission('appointment:transition'),
  mutationLimiter,
  validate({ params: idParamSchema, body: transitionAppointmentSchema }),
  appointmentController.transition,
);

router.post(
  '/:id/cancel',
  requireAnyPermission('appointment:cancel:own', 'appointment:cancel:any'),
  mutationLimiter,
  validate({ params: idParamSchema, body: cancelAppointmentSchema }),
  appointmentController.cancel,
);

export default router;
