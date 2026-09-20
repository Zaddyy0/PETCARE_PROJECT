import type { Types } from 'mongoose';
import { REVIEWS, type Review as ReviewDTO, type ReviewDetail } from '@pawsitive/shared';
import type { IReview } from '../models/review.model.js';

type ReviewLike = IReview & { _id: Types.ObjectId };

export function toReviewDTO(review: ReviewLike): ReviewDTO {
  const dto: ReviewDTO = {
    id: review._id.toString(),
    doctorId: review.doctor.toString(),
    clientId: review.client.toString(),
    clinicId: review.clinic.toString(),
    appointmentId: review.appointment.toString(),
    rating: review.rating,
    comment: review.comment,
    status: review.status,
    isVerified: review.isVerified,
    isAnonymous: review.isAnonymous,
    helpfulCount: review.helpfulCount,
    reportCount: review.reportCount,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };

  if (review.title) dto.title = review.title;
  if (review.breakdown) dto.breakdown = { ...review.breakdown };

  if (review.response) {
    dto.response = {
      comment: review.response.comment,
      respondedAt: review.response.respondedAt.toISOString(),
      respondedBy: review.response.respondedBy.toString(),
    };
  }

  if (review.moderatedBy) dto.moderatedBy = review.moderatedBy.toString();
  if (review.moderatedAt) dto.moderatedAt = review.moderatedAt.toISOString();
  if (review.moderationNote) dto.moderationNote = review.moderationNote;

  return dto;
}

export interface ReviewRelations {
  clientName: string;
  clientAvatar?: { url: string; publicId: string } | null;
  doctorName: string;
  petName?: string;
  appointmentDate: Date;
}

export function toReviewDetailDTO(
  review: ReviewLike,
  relations: ReviewRelations,
  viewerId: Types.ObjectId | null,
  now: Date = new Date(),
): ReviewDetail {
  const base = toReviewDTO(review);
  const isOwn = viewerId ? review.client.toString() === viewerId.toString() : false;

  /**
   * Anonymity is applied here, at the serialisation boundary.
   *
   * The author's id stays on the record — moderation and the "your reviews"
   * page both need it — but the displayed name becomes "Anonymous" for
   * everyone except the author themselves, who should still recognise their
   * own review in a list.
   */
  const displayName = review.isAnonymous && !isOwn ? 'Anonymous' : relations.clientName;

  const detail: ReviewDetail = {
    ...base,
    clientName: displayName,
    doctorName: relations.doctorName,
    appointmentDate: relations.appointmentDate.toISOString(),
    isOwn,
    canEdit: isOwn && withinEditWindow(review.createdAt, now),
  };

  /* An anonymous review must not carry an avatar either — a face identifies a
     person just as well as a name. */
  if (relations.clientAvatar && (!review.isAnonymous || isOwn)) {
    detail.clientAvatar = {
      url: relations.clientAvatar.url,
      publicId: relations.clientAvatar.publicId,
    };
  }

  if (relations.petName) detail.petName = relations.petName;

  return detail;
}

function withinEditWindow(createdAt: Date, now: Date): boolean {
  const hours = (now.getTime() - createdAt.getTime()) / 3_600_000;
  return hours <= REVIEWS.EDIT_WINDOW_HOURS;
}
