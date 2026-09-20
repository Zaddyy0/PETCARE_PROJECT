import { z } from 'zod';
import { MEDICAL_RECORD_TYPES, VACCINATION_STATUSES } from '../enums.js';
import {
  dateOnlySchema,
  isoDateTimeSchema,
  longTextSchema,
  objectIdSchema,
  paginationSchema,
  shortTextSchema,
} from './common.schema.js';

/* -------------------------------------------------------------------------- */
/*                                   Vitals                                   */
/* -------------------------------------------------------------------------- */

/**
 * Ranges are wide on purpose.
 *
 * These bounds exist to catch a slipped decimal point or a unit mix-up, not to
 * encode species-specific normals — a rabbit's resting heart rate would fail a
 * range tuned for dogs. Clinical interpretation belongs to the clinician.
 */
export const vitalsSchema = z.object({
  weightKg: z.number().positive().max(1000).optional(),
  temperatureCelsius: z.number().min(20).max(45).optional(),
  heartRateBpm: z.number().int().min(10).max(400).optional(),
  respiratoryRateBpm: z.number().int().min(1).max(200).optional(),
  bodyConditionScore: z.number().int().min(1).max(9).optional(),
  hydrationStatus: shortTextSchema(60).optional(),
});

export const prescriptionSchema = z.object({
  medication: z.string().trim().min(1, 'Medication name is required').max(120),
  dosage: z.string().trim().min(1, 'Dosage is required').max(60),
  frequency: z.string().trim().min(1, 'Frequency is required').max(60),
  durationDays: z.number().int().min(1, 'Duration must be at least a day').max(365),
  route: shortTextSchema(40).optional(),
  instructions: longTextSchema(500).optional(),
  startDate: dateOnlySchema.optional(),
});

/* -------------------------------------------------------------------------- */
/*                               Medical records                              */
/* -------------------------------------------------------------------------- */

export const createMedicalRecordSchema = z
  .object({
    petId: objectIdSchema,
    appointmentId: objectIdSchema.optional(),
    type: z.enum(MEDICAL_RECORD_TYPES).default('consultation'),
    /** Defaults to now. Back-dating is allowed; forward-dating is not. */
    visitDate: isoDateTimeSchema.optional(),
    chiefComplaint: z.string().trim().min(3, 'Describe the presenting complaint').max(500),
    diagnosis: z.string().trim().min(3, 'A diagnosis is required').max(2000),
    treatment: z.string().trim().min(3, 'Describe the treatment given').max(2000),
    notes: longTextSchema(5000).optional(),
    vitals: vitalsSchema.optional(),
    prescriptions: z.array(prescriptionSchema).max(20, 'At most 20 prescriptions').default([]),
    followUpRequired: z.boolean().default(false),
    followUpDate: dateOnlySchema.optional(),
    followUpNotes: longTextSchema(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.visitDate && new Date(value.visitDate).getTime() > Date.now() + 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['visitDate'],
        message: 'A visit cannot be recorded in the future',
      });
    }

    if (value.followUpRequired && !value.followUpDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['followUpDate'],
        message: 'Give a follow-up date',
      });
    }
  });

/**
 * Amendments.
 *
 * `.partial()` on the *unwrapped* object — a `ZodEffects` (what `superRefine`
 * returns) has no `.partial()`. We rebuild from the inner shape instead, which
 * also means the cross-field rules above do not fire on a partial patch where
 * the other half of the pair simply was not sent.
 */
export const updateMedicalRecordSchema = z.object({
  type: z.enum(MEDICAL_RECORD_TYPES).optional(),
  visitDate: isoDateTimeSchema.optional(),
  chiefComplaint: z.string().trim().min(3).max(500).optional(),
  diagnosis: z.string().trim().min(3).max(2000).optional(),
  treatment: z.string().trim().min(3).max(2000).optional(),
  notes: longTextSchema(5000).optional(),
  vitals: vitalsSchema.optional(),
  prescriptions: z.array(prescriptionSchema).max(20).optional(),
  followUpRequired: z.boolean().optional(),
  followUpDate: dateOnlySchema.optional(),
  followUpNotes: longTextSchema(1000).optional(),
  /** Mandatory once the record has locked; the service enforces that. */
  amendmentReason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500).optional(),
});

export const medicalRecordListQuerySchema = paginationSchema.extend({
  petId: objectIdSchema.optional(),
  doctorId: objectIdSchema.optional(),
  type: z.enum(MEDICAL_RECORD_TYPES).optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});

/* -------------------------------------------------------------------------- */
/*                                Vaccinations                                */
/* -------------------------------------------------------------------------- */

export const createVaccinationSchema = z
  .object({
    petId: objectIdSchema,
    vaccineName: z.string().trim().min(2, 'Vaccine name is required').max(120),
    manufacturer: shortTextSchema(120).optional(),
    batchNumber: shortTextSchema(60).optional(),
    doseNumber: z.number().int().min(1).max(20).default(1),
    totalDoses: z.number().int().min(1).max(20).optional(),
    administeredAt: isoDateTimeSchema.optional(),
    dueAt: isoDateTimeSchema,
    notes: longTextSchema(1000).optional(),
    medicalRecordId: objectIdSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.totalDoses && value.doseNumber > value.totalDoses) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['doseNumber'],
        message: 'The dose number cannot exceed the total number of doses',
      });
    }

    if (value.administeredAt && new Date(value.administeredAt).getTime() > Date.now() + 60_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['administeredAt'],
        message: 'A dose cannot be recorded as given in the future',
      });
    }
  });

export const updateVaccinationSchema = z.object({
  vaccineName: z.string().trim().min(2).max(120).optional(),
  manufacturer: shortTextSchema(120).optional(),
  batchNumber: shortTextSchema(60).optional(),
  doseNumber: z.number().int().min(1).max(20).optional(),
  totalDoses: z.number().int().min(1).max(20).optional(),
  administeredAt: isoDateTimeSchema.optional(),
  dueAt: isoDateTimeSchema.optional(),
  notes: longTextSchema(1000).optional(),
  status: z.enum(VACCINATION_STATUSES).optional(),
});

export const vaccinationListQuerySchema = paginationSchema.extend({
  petId: objectIdSchema.optional(),
  status: z.enum(VACCINATION_STATUSES).optional(),
  dueBefore: isoDateTimeSchema.optional(),
  dueAfter: isoDateTimeSchema.optional(),
});

export type CreateMedicalRecordInput = z.infer<typeof createMedicalRecordSchema>;
export type UpdateMedicalRecordInput = z.infer<typeof updateMedicalRecordSchema>;
export type MedicalRecordListQueryInput = z.infer<typeof medicalRecordListQuerySchema>;
export type CreateVaccinationInput = z.infer<typeof createVaccinationSchema>;
export type UpdateVaccinationInput = z.infer<typeof updateVaccinationSchema>;
export type VaccinationListQueryInput = z.infer<typeof vaccinationListQuerySchema>;
