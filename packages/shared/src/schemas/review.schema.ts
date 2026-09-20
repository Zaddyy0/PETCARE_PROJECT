import { z } from 'zod';
import { MAX_RATING, MIN_RATING, REVIEW_STATUSES } from '../enums.js';
import {
  objectIdSchema,
  paginationSchema,
  shortTextSchema,
} from './common.schema.js';

const ratingSchema = z
  .number()
  .int('Ratings are whole stars')
  .min(MIN_RATING, `Give at least ${MIN_RATING} star`)
  .max(MAX_RATING, `Give at most ${MAX_RATING} stars`);

export const reviewBreakdownSchema = z.object({
  expertise: ratingSchema,
  communication: ratingSchema,
  punctuality: ratingSchema,
  facilities: ratingSchema,
});

export const createReviewSchema = z.object({
  /**
   * Keyed on the appointment, not the doctor.
   *
   * A review belongs to a *visit*. Tying it to the appointment is what makes
   * "one review per visit" enforceable with a unique index, and what lets the
   * server verify the visit actually happened before accepting a rating.
   */
  appointmentId: objectIdSchema,
  rating: ratingSchema,
  title: shortTextSchema(100).optional(),
  comment: z
    .string()
    .trim()
    .min(10, 'Tell us a little more — at least 10 characters')
    .max(2000, 'Keep your review under 2000 characters'),
  breakdown: reviewBreakdownSchema.optional(),
  isAnonymous: z.boolean().default(false),
});

export const updateReviewSchema = createReviewSchema
  .omit({ appointmentId: true })
  .partial();

export const respondToReviewSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(10, 'Write at least 10 characters')
    .max(1000, 'Keep your reply under 1000 characters'),
});

export const moderateReviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  /** Recorded on the review and in the audit log. */
  note: shortTextSchema(500).optional(),
});

export const reviewListQuerySchema = paginationSchema.extend({
  doctorId: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  clinicId: objectIdSchema.optional(),
  status: z.enum(REVIEW_STATUSES).optional(),
  minRating: z.coerce.number().int().min(MIN_RATING).max(MAX_RATING).optional(),
  maxRating: z.coerce.number().int().min(MIN_RATING).max(MAX_RATING).optional(),
  withComment: z.coerce.boolean().optional(),
  sort: z.enum(['createdAt', 'rating', 'helpfulCount']).default('createdAt'),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
export type ReviewListQueryInput = z.infer<typeof reviewListQuerySchema>;
