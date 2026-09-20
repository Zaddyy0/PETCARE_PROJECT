/**
 * Doctor reviews.
 *
 * The thing that makes a rating system worth reading is that it cannot be
 * gamed. Two constraints do the work:
 *
 *   • **One review per appointment**, enforced by a unique index on
 *     `appointment` — not by an application-level "have they already reviewed?"
 *     check, which two concurrent submissions would both pass.
 *
 *   • **Only against a completed visit.** The service verifies the appointment
 *     belongs to the author and reached `completed` before a review is
 *     accepted, so every rating traces back to a real consultation.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  MAX_RATING,
  MIN_RATING,
  REVIEW_STATUSES,
  ReviewStatus,
  type ReviewStatus as ReviewStatusType,
} from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface IReviewBreakdown {
  expertise: number;
  communication: number;
  punctuality: number;
  facilities: number;
}

export interface IReviewResponse {
  comment: string;
  respondedAt: Date;
  respondedBy: Types.ObjectId;
}

export interface IReview {
  _id: Types.ObjectId;
  doctor: Types.ObjectId;
  client: Types.ObjectId;
  clinic: Types.ObjectId;
  appointment: Types.ObjectId;

  rating: number;
  title?: string;
  comment: string;
  breakdown?: IReviewBreakdown | null;

  status: ReviewStatusType;
  isVerified: boolean;
  isAnonymous: boolean;

  response?: IReviewResponse | null;

  helpfulCount: number;
  reportCount: number;
  /** Users who found it helpful, so one person cannot inflate the count. */
  helpfulBy: Types.ObjectId[];

  moderatedBy?: Types.ObjectId | null;
  moderatedAt?: Date | null;
  moderationNote?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

export type ReviewDocument = HydratedDocument<IReview>;
export type ReviewModel = Model<IReview>;

const breakdownSchema = new Schema<IReviewBreakdown>(
  {
    expertise: { type: Number, required: true, min: MIN_RATING, max: MAX_RATING },
    communication: { type: Number, required: true, min: MIN_RATING, max: MAX_RATING },
    punctuality: { type: Number, required: true, min: MIN_RATING, max: MAX_RATING },
    facilities: { type: Number, required: true, min: MIN_RATING, max: MAX_RATING },
  },
  { _id: false },
);

const reviewSchema = new Schema<IReview, ReviewModel>(
  {
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    appointment: { type: Schema.Types.ObjectId, ref: 'Appointment', required: true },

    rating: {
      type: Number,
      required: true,
      min: MIN_RATING,
      max: MAX_RATING,
      /* Guards against a fractional rating skewing the running sum. */
      validate: { validator: Number.isInteger, message: 'Ratings are whole stars' },
    },
    title: { type: String, trim: true, maxlength: 100 },
    comment: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    breakdown: { type: breakdownSchema, default: null },

    status: {
      type: String,
      enum: REVIEW_STATUSES,
      default: ReviewStatus.PUBLISHED,
      index: true,
    },
    isVerified: { type: Boolean, default: true },
    isAnonymous: { type: Boolean, default: false },

    response: {
      type: new Schema<IReviewResponse>(
        {
          comment: { type: String, required: true, trim: true, maxlength: 1000 },
          respondedAt: { type: Date, required: true, default: Date.now },
          respondedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        },
        { _id: false },
      ),
      default: null,
    },

    helpfulCount: { type: Number, default: 0, min: 0 },
    reportCount: { type: Number, default: 0, min: 0 },
    helpfulBy: { type: [Schema.Types.ObjectId], ref: 'User', default: [], select: false },

    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    moderatedAt: { type: Date, default: null },
    moderationNote: { type: String, default: null, maxlength: 500 },
  },
  { timestamps: true },
);

/**
 * One review per appointment. This is the anti-gaming guarantee.
 *
 * At the database level, so it holds under concurrency — a double-submitted
 * form creates one review and a clean duplicate-key error, not two ratings.
 */
reviewSchema.index({ appointment: 1 }, { unique: true, name: 'uniq_review_per_appointment' });

/* A doctor's public review list. */
reviewSchema.index({ doctor: 1, status: 1, createdAt: -1 });
reviewSchema.index({ doctor: 1, status: 1, rating: -1 });
/* The client's own reviews. */
reviewSchema.index({ client: 1, createdAt: -1 });
/* The admin moderation queue. */
reviewSchema.index({ clinic: 1, status: 1, createdAt: -1 });

/* `helpfulBy` is the de-duplication list, not something to publish. */
applyStandardTransform(reviewSchema, { omit: ['helpfulBy'] });

export const Review = (mongoose.models['Review'] as ReviewModel) ??
  mongoose.model<IReview>('Review', reviewSchema);

/** True when the failure was the one-review-per-appointment guard. */
export function isDuplicateReviewError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: number; message?: string };
  return candidate.code === 11000 && Boolean(candidate.message?.includes('uniq_review_per_appointment'));
}
