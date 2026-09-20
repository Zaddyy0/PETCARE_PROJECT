/**
 * Medical record and vaccination routes.
 *
 * The read/write split here is the clinical-authorship rule made visible:
 * reads accept `medical_record:read:*`, which admins hold, while every write
 * demands `medical_record:write`, which only clinicians hold. The service then
 * narrows further to the *treating* clinician.
 */

import { Router } from 'express';
import {
  createMedicalRecordSchema,
  createVaccinationSchema,
  idParamSchema,
  medicalRecordListQuerySchema,
  updateMedicalRecordSchema,
  updateVaccinationSchema,
  vaccinationListQuerySchema,
} from '@pawsitive/shared';
import { z } from 'zod';
import * as medicalController from '../controllers/medical.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { requireAnyPermission, requirePermission } from '../middleware/authorize.js';
import { mutationLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

router.use(authenticate);

const canReadRecords = requireAnyPermission(
  'medical_record:read:own',
  'medical_record:read:clinic',
  'medical_record:read:any',
);

/* ----------------------------- Medical records --------------------------- */

router.get(
  '/records',
  canReadRecords,
  validate({ query: medicalRecordListQuerySchema }),
  medicalController.listRecords,
);

router.get(
  '/records/:id',
  canReadRecords,
  validate({ params: idParamSchema }),
  medicalController.getRecord,
);

router.post(
  '/records',
  requirePermission('medical_record:write'),
  mutationLimiter,
  validate({ body: createMedicalRecordSchema }),
  medicalController.createRecord,
);

router.patch(
  '/records/:id',
  requirePermission('medical_record:write'),
  mutationLimiter,
  validate({ params: idParamSchema, body: updateMedicalRecordSchema }),
  medicalController.updateRecord,
);

/* Sign-off. There is deliberately no unlock route — see the service. */
router.post(
  '/records/:id/lock',
  requirePermission('medical_record:write'),
  mutationLimiter,
  validate({ params: idParamSchema }),
  medicalController.lockRecord,
);

/** A pet's full clinical timeline, for the pet detail page. */
router.get(
  '/pets/:petId/timeline',
  canReadRecords,
  validate({ params: z.object({ petId: idParamSchema.shape.id }) }),
  medicalController.petTimeline,
);

/* ------------------------------ Vaccinations ----------------------------- */

const canReadVaccinations = requireAnyPermission(
  'vaccination:read:own',
  'vaccination:read:clinic',
);

router.get(
  '/vaccinations',
  canReadVaccinations,
  validate({ query: vaccinationListQuerySchema }),
  medicalController.listVaccinations,
);

/**
 * Declared before `/vaccinations/:id` would be — there is no such route here,
 * but keeping the literal path first is the habit that avoids a parameterised
 * route swallowing it later.
 */
router.get('/vaccinations/schedule', canReadVaccinations, medicalController.schedule);

router.post(
  '/vaccinations',
  requirePermission('vaccination:write'),
  mutationLimiter,
  validate({ body: createVaccinationSchema }),
  medicalController.createVaccination,
);

router.patch(
  '/vaccinations/:id',
  requirePermission('vaccination:write'),
  mutationLimiter,
  validate({ params: idParamSchema, body: updateVaccinationSchema }),
  medicalController.updateVaccination,
);

export default router;
