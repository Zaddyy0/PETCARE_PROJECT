import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from './common.schema.js';

/**
 * Analytics query.
 *
 * Note what is absent: a `scope` parameter. The server derives the scope from
 * the caller's permissions, so there is nothing here for a client to ask for
 * that it might not be entitled to. A `scope: 'platform'` field would need an
 * authorization check on every request that consumed it.
 */
export const analyticsQuerySchema = z
  .object({
    period: z.enum(['7d', '30d', '90d', '12m', 'custom']).default('30d'),
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
    /* Honoured only for a super admin; narrowed or ignored for everyone else. */
    clinicId: objectIdSchema.optional(),
    doctorId: objectIdSchema.optional(),
  })
  .refine((value) => value.period !== 'custom' || Boolean(value.from), {
    message: 'A custom period needs a start date',
    path: ['from'],
  })
  .refine(
    (value) => !value.from || !value.to || new Date(value.from) < new Date(value.to),
    { message: 'The start must come before the end', path: ['from'] },
  );

export type AnalyticsQueryInput = z.infer<typeof analyticsQuerySchema>;

export const notificationQuerySchema = z.object({
  cursor: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
