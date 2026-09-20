import { z } from 'zod';
import { PET_SEXES, PET_SPECIES, PET_STATUSES } from '../enums.js';
import {
  dateOnlySchema,
  longTextSchema,
  objectIdSchema,
  paginationSchema,
  shortTextSchema,
  tagListSchema,
} from './common.schema.js';

/** Rejects a birth date in the future, and anything implausibly old. */
const petDateOfBirthSchema = dateOnlySchema.superRefine((value, ctx) => {
  const dob = new Date(`${value}T00:00:00.000Z`);
  const now = new Date();

  if (dob.getTime() > now.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A birth date cannot be in the future' });
  }

  /* 50 years covers a parrot or a tortoise with room to spare; beyond that it
     is almost certainly a typo in the year. */
  const fiftyYearsAgo = new Date(now.getFullYear() - 50, now.getMonth(), now.getDate());
  if (dob.getTime() < fiftyYearsAgo.getTime()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please check that birth date' });
  }
});

export const createPetSchema = z.object({
  name: z.string().trim().min(1, 'Give your pet a name').max(40),
  species: z.enum(PET_SPECIES),
  breed: shortTextSchema(60).optional(),
  sex: z.enum(PET_SEXES).default('unknown'),
  dateOfBirth: petDateOfBirthSchema.optional(),
  isDateOfBirthApproximate: z.boolean().default(false),
  weightKg: z
    .number()
    .positive('Weight must be greater than zero')
    .max(1000, 'Please check that weight')
    .optional(),
  color: shortTextSchema(40).optional(),
  /** Standard ISO 11784/11785 chips are 15 digits; some legacy chips are 9–10. */
  microchipId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{9,20}$/, 'Enter a valid microchip number')
    .optional(),
  allergies: tagListSchema(20, 60),
  chronicConditions: tagListSchema(20, 80),
  currentMedications: tagListSchema(20, 80),
  isNeutered: z.boolean().default(false),
  isInsured: z.boolean().default(false),
  insuranceProvider: shortTextSchema(80).optional(),
  insurancePolicyNumber: shortTextSchema(60).optional(),
  emergencyNotes: longTextSchema(1000).optional(),
  /** Stripped by the service unless the caller holds `pet:update:any`. */
  ownerId: objectIdSchema.optional(),
});

export const updatePetSchema = createPetSchema.omit({ ownerId: true }).partial();

export const petListQuerySchema = paginationSchema.extend({
  species: z.enum(PET_SPECIES).optional(),
  status: z.enum(PET_STATUSES).optional(),
  ownerId: objectIdSchema.optional(),
  sort: z.enum(['createdAt', 'name', 'nextAppointmentAt']).default('createdAt'),
});

export const archivePetSchema = z.object({
  reason: shortTextSchema(200).optional(),
  /** Set when the pet has died, which also stops all reminders. */
  deceased: z.boolean().default(false),
});

export type CreatePetInput = z.infer<typeof createPetSchema>;
export type UpdatePetInput = z.infer<typeof updatePetSchema>;
export type PetListQueryInput = z.infer<typeof petListQuerySchema>;
