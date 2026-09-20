import type { ReviewStatus } from '../enums.js';
import type {
  AppointmentId,
  ClinicId,
  DoctorId,
  ISODateString,
  MediaAsset,
  ReviewId,
  Timestamps,
  UserId,
} from './common.js';

/**
 * A client's review of a doctor.
 *
 * Two rules make the ratings trustworthy rather than decorative:
 *
 *   1. **One review per appointment.** Enforced by a unique index on
 *      `appointmentId`, not by an application-level "have they already?" check
 *      that two concurrent submits would both pass.
 *   2. **Only verified visits.** A review may only be written against an
 *      appointment the author actually attended and that reached `completed`.
 *      No completed visit, no review — which is what `isVerified` attests.
 */
export interface Review extends Timestamps {
  id: ReviewId;
  doctorId: DoctorId;
  clientId: UserId;
  clinicId: ClinicId;
  appointmentId: AppointmentId;

  /** Integer 1–5. */
  rating: number;
  title?: string;
  comment: string;

  /** Optional sub-scores; each independently 1–5. */
  breakdown?: ReviewBreakdown;

  status: ReviewStatus;
  /** Always true in practice — reviews require a completed appointment. */
  isVerified: boolean;
  /** Client chose to publish without their name attached. */
  isAnonymous: boolean;

  /** The doctor's public reply. One per review. */
  response?: ReviewResponse;

  helpfulCount: number;
  reportCount: number;
  moderatedBy?: UserId;
  moderatedAt?: ISODateString;
  moderationNote?: string;
}

export interface ReviewBreakdown {
  expertise: number;
  communication: number;
  punctuality: number;
  facilities: number;
}

export interface ReviewResponse {
  comment: string;
  respondedAt: ISODateString;
  respondedBy: UserId;
}

export interface ReviewDetail extends Review {
  /** Replaced with "Anonymous" when `isAnonymous` is set. */
  clientName: string;
  clientAvatar?: MediaAsset;
  doctorName: string;
  petName?: string;
  appointmentDate: ISODateString;
  /** True when the calling user wrote this review. */
  isOwn: boolean;
  canEdit: boolean;
}

export interface CreateReviewPayload {
  appointmentId: AppointmentId;
  rating: number;
  title?: string;
  comment: string;
  breakdown?: ReviewBreakdown;
  isAnonymous?: boolean;
}

export type UpdateReviewPayload = Partial<Omit<CreateReviewPayload, 'appointmentId'>>;

export interface RespondToReviewPayload {
  comment: string;
}

export interface ModerateReviewPayload {
  status: ReviewStatus;
  note?: string;
}

export interface ReviewListQuery {
  page?: number;
  limit?: number;
  doctorId?: DoctorId;
  clientId?: UserId;
  clinicId?: ClinicId;
  status?: ReviewStatus;
  minRating?: number;
  maxRating?: number;
  /** Only reviews that have a written comment. */
  withComment?: boolean;
  sort?: 'createdAt' | 'rating' | 'helpfulCount';
  order?: 'asc' | 'desc';
}

/** Aggregate view rendered above a doctor's review list. */
export interface ReviewSummary {
  doctorId: DoctorId;
  average: number;
  total: number;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
  breakdownAverages?: ReviewBreakdown;
  /** Share of completed appointments that produced a review. */
  responseRate: number;
}
