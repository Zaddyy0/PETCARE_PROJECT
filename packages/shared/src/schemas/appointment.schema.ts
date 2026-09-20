import { z } from 'zod';
import { APPOINTMENT_STATUSES, APPOINTMENT_TYPES } from '../enums.js';
import {
  arrayOrSingle,
  dateOnlySchema,
  isoDateTimeSchema,
  longTextSchema,
  objectIdSchema,
  paginationSchema,
  shortTextSchema,
} from './common.schema.js';

export const createAppointmentSchema = z.object({
  petId: objectIdSchema,
  doctorId: objectIdSchema,
  /**
   * The server does **not** trust this value as a time.
   *
   * It is re-snapped to the doctor's generated slot grid and re-checked against
   * their availability before anything is written. Accepting a client-supplied
   * start verbatim is how you end up with appointments at 09:07 that no
   * calendar view can render.
   */
  slotStart: isoDateTimeSchema,
  type: z.enum(APPOINTMENT_TYPES),
  reason: z.string().trim().min(3, 'Tell us briefly why you are visiting').max(200),
  clientNotes: longTextSchema(1000).optional(),
  /** Honoured only for staff callers; silently dropped for clients. */
  clientId: objectIdSchema.optional(),
});

export const rescheduleAppointmentSchema = z.object({
  slotStart: isoDateTimeSchema,
  /** Allows moving the visit to a colleague as well as to a new time. */
  doctorId: objectIdSchema.optional(),
  reason: shortTextSchema(300).optional(),
});

export const transitionAppointmentSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES),
  reason: shortTextSchema(300).optional(),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().min(3, 'Please give a short reason').max(300),
});

export const appointmentListQuerySchema = paginationSchema.extend({
  status: arrayOrSingle(z.enum(APPOINTMENT_STATUSES)).optional(),
  type: z.enum(APPOINTMENT_TYPES).optional(),
  doctorId: objectIdSchema.optional(),
  petId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  clinicId: objectIdSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  sort: z.enum(['slotStart', 'createdAt', 'status']).default('slotStart'),
});

/**
 * Availability lookup.
 *
 * The window is capped at 62 days: generating a slot grid is cheap per day but
 * unbounded `from`/`to` would let one request ask for a decade of slots.
 */
export const slotQuerySchema = z
  .object({
    from: dateOnlySchema,
    to: dateOnlySchema,
  })
  .refine((value) => value.from <= value.to, {
    message: 'The start date must not be after the end date',
    path: ['from'],
  })
  .refine(
    (value) => {
      const days =
        (Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`)) /
        86_400_000;
      return days <= 62;
    },
    { message: 'Ask for at most 62 days at a time', path: ['to'] },
  );

export const calendarQuerySchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    doctorId: objectIdSchema.optional(),
    clinicId: objectIdSchema.optional(),
  })
  .refine((value) => new Date(value.from) < new Date(value.to), {
    message: 'The start must come before the end',
    path: ['from'],
  });

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type TransitionAppointmentInput = z.infer<typeof transitionAppointmentSchema>;
export type AppointmentListQueryInput = z.infer<typeof appointmentListQuerySchema>;
export type SlotQueryInput = z.infer<typeof slotQuerySchema>;
