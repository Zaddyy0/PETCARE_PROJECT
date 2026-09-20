import { z } from 'zod';
import { DAYS_OF_WEEK, ROLES, USER_STATUSES } from '../enums.js';
import {
  addressSchema,
  amountMinorSchema,
  currencySchema,
  dateOnlySchema,
  emailSchema,
  longTextSchema,
  nameSchema,
  objectIdSchema,
  paginationSchema,
  passwordSchema,
  phoneSchema,
  shortTextSchema,
  tagListSchema,
  timeOfDaySchema,
  timezoneSchema,
} from './common.schema.js';

/* -------------------------------------------------------------------------- */
/*                                    Users                                   */
/* -------------------------------------------------------------------------- */

export const notificationPreferencesSchema = z.object({
  email: z.boolean().default(true),
  inApp: z.boolean().default(true),
  push: z.boolean().default(false),
  appointmentReminders: z.boolean().default(true),
  vaccinationReminders: z.boolean().default(true),
  marketing: z.boolean().default(false),
});

export const updateProfileSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: phoneSchema.optional(),
  address: addressSchema.optional(),
  locale: z.string().trim().min(2).max(10).optional(),
  timezone: timezoneSchema.optional(),
  notificationPreferences: notificationPreferencesSchema.partial().optional(),
});

export const createUserSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    email: emailSchema,
    role: z.enum(ROLES),
    phone: phoneSchema.optional(),
    clinicId: objectIdSchema.optional(),
    /** Default path: email an invite rather than set a password for someone. */
    sendInvite: z.boolean().default(true),
    password: passwordSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.sendInvite && !value.password) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'Set a password or send an invitation',
      });
    }

    /* Doctors and admins are always scoped to a clinic; clients never are. */
    if ((value.role === 'doctor' || value.role === 'admin') && !value.clinicId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['clinicId'],
        message: 'Choose a clinic for this role',
      });
    }
  });

export const updateUserSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phone: phoneSchema.optional(),
  address: addressSchema.optional(),
  clinicId: objectIdSchema.nullable().optional(),
  status: z.enum(USER_STATUSES).optional(),
});

export const changeRoleSchema = z.object({
  role: z.enum(ROLES),
  clinicId: objectIdSchema.optional(),
  reason: z.string().trim().min(5, 'Give a short reason').max(300),
});

export const suspendUserSchema = z.object({
  reason: z.string().trim().min(5, 'Give a short reason').max(300),
  /** Omit for an indefinite suspension. */
  until: dateOnlySchema.optional(),
});

export const userListQuerySchema = paginationSchema.extend({
  role: z.enum(ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  clinicId: objectIdSchema.optional(),
  sort: z.enum(['createdAt', 'lastLoginAt', 'firstName']).default('createdAt'),
});

/* -------------------------------------------------------------------------- */
/*                                   Clinics                                  */
/* -------------------------------------------------------------------------- */

export const createClinicSchema = z.object({
  name: z.string().trim().min(2, 'Clinic name is required').max(120),
  description: longTextSchema(2000).optional(),
  email: emailSchema,
  phone: phoneSchema,
  address: addressSchema,
  timezone: timezoneSchema.default('Asia/Kolkata'),
  currency: currencySchema.default('INR'),
});

export const updateClinicSchema = createClinicSchema.partial();

/* -------------------------------------------------------------------------- */
/*                                   Doctors                                  */
/* -------------------------------------------------------------------------- */

export const qualificationSchema = z.object({
  degree: z.string().trim().min(1, 'Degree is required').max(120),
  institution: z.string().trim().min(1, 'Institution is required').max(160),
  year: z
    .number()
    .int()
    .min(1900, 'Please check that year')
    .max(new Date().getFullYear(), 'That year is in the future'),
});

export const createDoctorSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  phone: phoneSchema.optional(),
  clinicId: objectIdSchema.optional(),
  sendInvite: z.boolean().default(true),
  password: passwordSchema.optional(),

  title: z.string().trim().min(2, 'Title is required').max(60).default('Veterinarian'),
  bio: longTextSchema(2000).default(''),
  specializations: tagListSchema(15, 60),
  qualifications: z.array(qualificationSchema).max(10).default([]),
  licenseNumber: z.string().trim().min(3, 'License number is required').max(60),
  licenseExpiresAt: dateOnlySchema.optional(),
  yearsOfExperience: z.number().int().min(0).max(70).default(0),
  languages: tagListSchema(10, 40),
  consultationFeeMinor: amountMinorSchema.default(0),
});

export const updateDoctorSchema = z.object({
  title: z.string().trim().min(2).max(60).optional(),
  bio: longTextSchema(2000).optional(),
  specializations: tagListSchema(15, 60).optional(),
  qualifications: z.array(qualificationSchema).max(10).optional(),
  licenseNumber: z.string().trim().min(3).max(60).optional(),
  licenseExpiresAt: dateOnlySchema.optional(),
  yearsOfExperience: z.number().int().min(0).max(70).optional(),
  languages: tagListSchema(10, 40).optional(),
  consultationFeeMinor: amountMinorSchema.optional(),
  isAcceptingPatients: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/*                                Availability                                */
/* -------------------------------------------------------------------------- */

/** A working block. Half-open `[start, end)`, so `09:00–13:00` abuts `13:00–17:00`. */
const timeBlockSchema = z
  .object({
    start: timeOfDaySchema,
    end: timeOfDaySchema,
  })
  .refine((value) => value.start < value.end, {
    message: 'The end time must come after the start time',
    path: ['end'],
  });

/**
 * Blocks within one day must not overlap.
 *
 * Overlapping blocks would generate duplicate slot start times, and a duplicate
 * start is exactly what the booking unique index rejects — so the doctor would
 * publish hours that silently cannot be booked. Catch it at configuration time.
 */
const nonOverlappingBlocks = z.array(timeBlockSchema).max(6).superRefine((blocks, ctx) => {
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start));

  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous && current && current.start < previous.end) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `The block starting ${current.start} overlaps the one ending ${previous.end}`,
      });
      break;
    }
  }
});

export const weeklyAvailabilitySchema = z.object({
  dayOfWeek: z.union([
    z.literal(DAYS_OF_WEEK[0]),
    z.literal(DAYS_OF_WEEK[1]),
    z.literal(DAYS_OF_WEEK[2]),
    z.literal(DAYS_OF_WEEK[3]),
    z.literal(DAYS_OF_WEEK[4]),
    z.literal(DAYS_OF_WEEK[5]),
    z.literal(DAYS_OF_WEEK[6]),
  ]),
  blocks: nonOverlappingBlocks.default([]),
});

export const availabilityOverrideSchema = z.object({
  date: dateOnlySchema,
  isUnavailable: z.boolean().default(false),
  blocks: nonOverlappingBlocks.default([]),
  reason: shortTextSchema(200).optional(),
});

export const updateAvailabilitySchema = z.object({
  timezone: timezoneSchema.optional(),
  /**
   * Constrained to divisors of 60 so the generated grid aligns to the hour.
   * A 25-minute slot drifts: 09:00, 09:25, 09:50, 10:15 — unreadable calendars
   * and impossible-to-describe opening hours.
   */
  slotDurationMinutes: z
    .union([z.literal(10), z.literal(15), z.literal(20), z.literal(30), z.literal(60)])
    .optional(),
  bufferMinutes: z.number().int().min(0).max(60).optional(),
  advanceBookingDays: z.number().int().min(1).max(365).optional(),
  minimumNoticeMinutes: z.number().int().min(0).max(10_080).optional(),
  weekly: z.array(weeklyAvailabilitySchema).max(7).optional(),
  overrides: z.array(availabilityOverrideSchema).max(120).optional(),
});

export const doctorListQuerySchema = paginationSchema.extend({
  specialization: shortTextSchema(60).optional(),
  clinicId: objectIdSchema.optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  isAcceptingPatients: z.coerce.boolean().optional(),
  sort: z.enum(['rating', 'experience', 'fee', 'name']).default('rating'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type CreateDoctorInput = z.infer<typeof createDoctorSchema>;
export type UpdateDoctorInput = z.infer<typeof updateDoctorSchema>;
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
export type CreateClinicInput = z.infer<typeof createClinicSchema>;
export type UserListQueryInput = z.infer<typeof userListQuerySchema>;
export type DoctorListQueryInput = z.infer<typeof doctorListQuerySchema>;
