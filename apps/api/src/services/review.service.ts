/**
 * Doctor reviews and ratings.
 *
 * What makes the ratings trustworthy rather than decorative:
 *
 *   • **Verified visits only.** A review requires a `completed` appointment
 *     that belongs to the author. No visit, no rating.
 *   • **One per visit**, enforced by a unique index, so a double-submitted form
 *     cannot become two five-star reviews.
 *   • **Aggregates maintained atomically.** `$inc` on the doctor's running sum
 *     and count, never a recompute over every review — which is fine at a
 *     hundred and a table scan at fifty thousand.
 */

import { Types } from 'mongoose';
import {
  AppointmentStatus,
  ERROR_CODES,
  NotificationType,
  REVIEWS,
  RATED_REVIEW_STATUSES,
  Role,
  ReviewStatus,
  type CreateReviewInput,
  type ModerateReviewInput,
  type ReviewListQueryInput,
  type ReviewSummary,
  type UpdateReviewInput,
} from '@pawsitive/shared';
import { toReviewDTO, toReviewDetailDTO } from '../dto/review.dto.js';
import { Appointment } from '../models/appointment.model.js';
import { Doctor } from '../models/doctor.model.js';
import { Pet } from '../models/pet.model.js';
import { Review, type ReviewDocument } from '../models/review.model.js';
import { User } from '../models/user.model.js';
import { ApiError } from '../utils/api-error.js';
import { buildPaginationMeta, buildSort, resolvePage } from '../utils/pagination.js';
import type { AuthContext } from '../types/express.js';
import { recordAudit, type AuditActor } from './audit.service.js';
import { notify } from './notification.service.js';
import { toObjectId } from './scope.js';

const SORTABLE = ['createdAt', 'rating', 'helpfulCount'] as const;

/* -------------------------------------------------------------------------- */
/*                                    List                                    */
/* -------------------------------------------------------------------------- */

export async function listReviews(auth: AuthContext | null, query: ReviewListQueryInput) {
  const { page, limit, skip } = resolvePage(query);
  const filter: Record<string, unknown> = {};

  if (query.doctorId) filter['doctor'] = toObjectId(query.doctorId, 'doctorId');
  if (query.clinicId) filter['clinicId'] = toObjectId(query.clinicId, 'clinicId');

  /**
   * Status visibility.
   *
   * The public sees published reviews only. A moderator may ask for any status
   * — that is the moderation queue. A client asking for their own reviews sees
   * theirs whatever the status, including ones hidden by an admin, because
   * being told your review was hidden is better than it silently vanishing.
   */
  const canModerate = auth?.permissions.has('review:moderate') ?? false;
  const wantsOwn = query.clientId && auth && query.clientId === auth.userId.toString();

  if (query.clientId) {
    if (!wantsOwn && !canModerate) {
      throw ApiError.forbidden(ERROR_CODES.FORBIDDEN);
    }
    filter['client'] = toObjectId(query.clientId, 'clientId');
  }

  if (query.status) {
    if (!canModerate && !wantsOwn) {
      throw ApiError.forbidden(ERROR_CODES.FORBIDDEN);
    }
    filter['status'] = query.status;
  } else if (!canModerate && !wantsOwn) {
    filter['status'] = ReviewStatus.PUBLISHED;
  }

  if (query.minRating != null || query.maxRating != null) {
    const range: Record<string, number> = {};
    if (query.minRating != null) range['$gte'] = query.minRating;
    if (query.maxRating != null) range['$lte'] = query.maxRating;
    filter['rating'] = range;
  }

  const sort = buildSort(query.sort, query.order, SORTABLE, 'createdAt');

  const [reviews, total] = await Promise.all([
    Review.find(filter).sort(sort).skip(skip).limit(limit),
    Review.countDocuments(filter),
  ]);

  const relations = await loadReviewRelations(reviews);

  const items = reviews.map((review) =>
    toReviewDetailDTO(review, relations.get(review._id.toString()) as never, auth?.userId ?? null),
  );

  return { items, pagination: buildPaginationMeta(total, { page, limit }) };
}

async function loadReviewRelations(reviews: ReviewDocument[]) {
  if (reviews.length === 0) return new Map();

  const clientIds = [...new Set(reviews.map((review) => review.client.toString()))];
  const doctorIds = [...new Set(reviews.map((review) => review.doctor.toString()))];
  const appointmentIds = [...new Set(reviews.map((review) => review.appointment.toString()))];

  const [clients, doctors, appointments] = await Promise.all([
    User.find({ _id: { $in: clientIds } }).select('firstName lastName avatar').lean(),
    Doctor.find({ _id: { $in: doctorIds } }).select('user title').lean(),
    Appointment.find({ _id: { $in: appointmentIds } }).select('slotStart pet').lean(),
  ]);

  const doctorUsers = await User.find({ _id: { $in: doctors.map((d) => d.user) } })
    .select('firstName lastName')
    .lean();

  const pets = await Pet.find({ _id: { $in: appointments.map((a) => a.pet) } })
    .select('name')
    .lean();

  const clientMap = new Map(clients.map((c) => [c._id.toString(), c]));
  const userMap = new Map(doctorUsers.map((u) => [u._id.toString(), u]));
  const doctorMap = new Map(doctors.map((d) => [d._id.toString(), d]));
  const appointmentMap = new Map(appointments.map((a) => [a._id.toString(), a]));
  const petMap = new Map(pets.map((p) => [p._id.toString(), p.name]));

  const relations = new Map();

  for (const review of reviews) {
    const client = clientMap.get(review.client.toString());
    const doctor = doctorMap.get(review.doctor.toString());
    const doctorUser = doctor ? userMap.get(doctor.user.toString()) : undefined;
    const appointment = appointmentMap.get(review.appointment.toString());

    relations.set(review._id.toString(), {
      clientName: client ? `${client.firstName} ${client.lastName}`.trim() : 'A client',
      clientAvatar: client?.avatar ?? null,
      doctorName: doctorUser
        ? `${doctor?.title ?? ''} ${doctorUser.firstName} ${doctorUser.lastName}`.trim()
        : 'A veterinarian',
      ...(appointment && petMap.get(appointment.pet.toString())
        ? { petName: petMap.get(appointment.pet.toString()) }
        : {}),
      appointmentDate: appointment?.slotStart ?? review.createdAt,
    });
  }

  return relations;
}

/**
 * A doctor's rating summary.
 *
 * Read straight off the maintained aggregate — one document read rather than an
 * aggregation over the review collection. `responseRate` is the share of
 * completed visits that produced a review, which is the honest denominator: a
 * 5.0 from two reviews out of two hundred visits means something different from
 * a 4.6 from a hundred and eighty.
 */
export async function getSummary(doctorId: string): Promise<ReviewSummary> {
  const id = toObjectId(doctorId, 'doctorId');
  const doctor = await Doctor.findById(id).select('ratingSum ratingCount ratingAverage ratingDistribution').lean();

  if (!doctor) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that doctor.');
  }

  const [completedVisits, breakdown] = await Promise.all([
    Appointment.countDocuments({ doctor: id, status: AppointmentStatus.COMPLETED }),
    averageBreakdown(id),
  ]);

  return {
    doctorId: id.toString(),
    average: doctor.ratingAverage,
    total: doctor.ratingCount,
    distribution: {
      1: doctor.ratingDistribution[1],
      2: doctor.ratingDistribution[2],
      3: doctor.ratingDistribution[3],
      4: doctor.ratingDistribution[4],
      5: doctor.ratingDistribution[5],
    },
    ...(breakdown ? { breakdownAverages: breakdown } : {}),
    responseRate: completedVisits > 0 ? doctor.ratingCount / completedVisits : 0,
  };
}

async function averageBreakdown(doctorId: Types.ObjectId) {
  const [row] = await Review.aggregate<{
    expertise: number;
    communication: number;
    punctuality: number;
    facilities: number;
  }>([
    {
      $match: {
        doctor: doctorId,
        status: { $in: [...RATED_REVIEW_STATUSES] },
        breakdown: { $ne: null },
      },
    },
    {
      $group: {
        _id: null,
        expertise: { $avg: '$breakdown.expertise' },
        communication: { $avg: '$breakdown.communication' },
        punctuality: { $avg: '$breakdown.punctuality' },
        facilities: { $avg: '$breakdown.facilities' },
      },
    },
    {
      $project: {
        _id: 0,
        expertise: { $round: ['$expertise', 1] },
        communication: { $round: ['$communication', 1] },
        punctuality: { $round: ['$punctuality', 1] },
        facilities: { $round: ['$facilities', 1] },
      },
    },
  ]);

  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/*                                   Create                                   */
/* -------------------------------------------------------------------------- */

export async function createReview(auth: AuthContext, input: CreateReviewInput) {
  const appointment = await Appointment.findById(
    toObjectId(input.appointmentId, 'appointmentId'),
  );

  if (!appointment) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that appointment.');
  }

  /* The author must be the client who attended. */
  if (appointment.client.toString() !== auth.userId.toString()) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that appointment.');
  }

  if (appointment.status !== AppointmentStatus.COMPLETED) {
    throw ApiError.badRequest(
      ERROR_CODES.REVIEW_REQUIRES_COMPLETED_VISIT,
      'You can review a doctor once the visit is complete.',
    );
  }

  /* The window closes, so a rating always reflects a recent experience. */
  const completedAt = appointment.completedAt ?? appointment.slotStart;
  const daysSince = (Date.now() - completedAt.getTime()) / 86_400_000;

  if (daysSince > REVIEWS.WINDOW_DAYS) {
    throw ApiError.forbidden(
      ERROR_CODES.REVIEW_WINDOW_PASSED,
      `Reviews close ${REVIEWS.WINDOW_DAYS} days after a visit.`,
    );
  }

  let review: ReviewDocument;

  try {
    review = await Review.create({
      doctor: appointment.doctor,
      client: auth.userId,
      clinic: appointment.clinic,
      appointment: appointment._id,
      rating: input.rating,
      ...(input.title ? { title: input.title } : {}),
      comment: input.comment,
      ...(input.breakdown ? { breakdown: input.breakdown } : {}),
      isAnonymous: input.isAnonymous ?? false,
      isVerified: true,
      status: ReviewStatus.PUBLISHED,
    });
  } catch (error) {
    /* The unique index on `appointment` is what makes "one review per visit"
       hold under a double submit. */
    if ((error as { code?: number }).code === 11000) {
      throw ApiError.conflict(ERROR_CODES.REVIEW_ALREADY_EXISTS);
    }
    throw error;
  }

  await applyRatingDelta(appointment.doctor, { [input.rating]: 1 }, input.rating, 1);
  await Appointment.updateOne({ _id: appointment._id }, { $set: { hasReview: true } });

  void notifyDoctorOfReview(review);

  return toReviewDTO(review);
}

/**
 * Apply a rating change to the doctor's running aggregate.
 *
 * `$inc` throughout, so concurrent reviews cannot lose each other's
 * contribution the way a read-modify-write would. `ratingAverage` is derived
 * afterwards because `updateOne` bypasses the pre-save hook that normally
 * computes it.
 */
async function applyRatingDelta(
  doctorId: Types.ObjectId,
  distributionDelta: Record<number, number>,
  sumDelta: number,
  countDelta: number,
): Promise<void> {
  const inc: Record<string, number> = {
    ratingSum: sumDelta,
    ratingCount: countDelta,
  };

  for (const [star, delta] of Object.entries(distributionDelta)) {
    inc[`ratingDistribution.${star}`] = delta;
  }

  await Doctor.updateOne({ _id: doctorId }, { $inc: inc });

  /* Recompute the derived average from the now-authoritative sum and count. */
  const doctor = await Doctor.findById(doctorId).select('ratingSum ratingCount');
  if (!doctor) return;

  doctor.ratingAverage =
    doctor.ratingCount > 0
      ? Math.round((doctor.ratingSum / doctor.ratingCount) * 100) / 100
      : 0;

  await doctor.save();
}

async function notifyDoctorOfReview(review: ReviewDocument): Promise<void> {
  const doctor = await Doctor.findById(review.doctor).select('user').lean();
  if (!doctor) return;

  await notify({
    userId: doctor.user,
    type: NotificationType.REVIEW_RECEIVED,
    title: `New ${review.rating}-star review`,
    body: review.title ?? review.comment.slice(0, 120),
    data: { reviewId: review._id.toString() },
    actionUrl: '/app/reviews',
  });
}

/* -------------------------------------------------------------------------- */
/*                               Update / delete                              */
/* -------------------------------------------------------------------------- */

export async function updateReview(
  auth: AuthContext,
  reviewId: string,
  input: UpdateReviewInput,
) {
  const review = await Review.findById(toObjectId(reviewId, 'reviewId'));

  if (!review || review.client.toString() !== auth.userId.toString()) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that review.');
  }

  const hours = (Date.now() - review.createdAt.getTime()) / 3_600_000;

  if (hours > REVIEWS.EDIT_WINDOW_HOURS) {
    throw ApiError.forbidden(
      ERROR_CODES.REVIEW_EDIT_WINDOW_PASSED,
      `Reviews can be edited for ${REVIEWS.EDIT_WINDOW_HOURS} hours after posting.`,
    );
  }

  const previousRating = review.rating;

  if (input.rating !== undefined) review.rating = input.rating;
  if (input.title !== undefined) review.title = input.title;
  if (input.comment !== undefined) review.comment = input.comment;
  if (input.breakdown !== undefined) review.breakdown = input.breakdown;
  if (input.isAnonymous !== undefined) review.isAnonymous = input.isAnonymous;

  await review.save();

  /* A changed star rating has to move the aggregate: remove the old, add the
     new, leaving the count untouched. */
  if (input.rating !== undefined && input.rating !== previousRating) {
    await applyRatingDelta(
      review.doctor,
      { [previousRating]: -1, [input.rating]: 1 },
      input.rating - previousRating,
      0,
    );
  }

  return toReviewDTO(review);
}

export async function deleteOwnReview(auth: AuthContext, reviewId: string) {
  const review = await Review.findById(toObjectId(reviewId, 'reviewId'));

  if (!review || review.client.toString() !== auth.userId.toString()) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that review.');
  }

  /* Withdrawn, not destroyed — the appointment link and moderation history stay
     intact, and the rating is removed from the aggregate. */
  const wasRated = RATED_REVIEW_STATUSES.includes(review.status);

  review.status = ReviewStatus.REMOVED;
  await review.save();

  if (wasRated) {
    await applyRatingDelta(review.doctor, { [review.rating]: -1 }, -review.rating, -1);
  }

  await Appointment.updateOne({ _id: review.appointment }, { $set: { hasReview: false } });

  return { reviewId: review._id.toString(), status: review.status };
}

/* -------------------------------------------------------------------------- */
/*                            Doctor reply & moderation                       */
/* -------------------------------------------------------------------------- */

export async function respondToReview(auth: AuthContext, reviewId: string, comment: string) {
  const review = await Review.findById(toObjectId(reviewId, 'reviewId'));

  if (!review) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that review.');
  }

  /* Only the reviewed doctor may reply — not a colleague, and not an admin
     speaking in their name. */
  if (!auth.doctorId || review.doctor.toString() !== auth.doctorId.toString()) {
    throw ApiError.forbidden(
      ERROR_CODES.FORBIDDEN,
      'Only the reviewed veterinarian can reply.',
    );
  }

  if (review.response) {
    throw ApiError.conflict(ERROR_CODES.CONFLICT, 'You have already replied to this review.');
  }

  review.response = {
    comment,
    respondedAt: new Date(),
    respondedBy: auth.userId,
  };

  await review.save();
  return toReviewDTO(review);
}

export async function moderateReview(
  auth: AuthContext,
  reviewId: string,
  input: ModerateReviewInput,
  actor: AuditActor,
) {
  const review = await Review.findById(toObjectId(reviewId, 'reviewId'));

  if (!review) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that review.');
  }

  if (auth.role !== Role.SUPER_ADMIN && review.clinic.toString() !== auth.clinicId?.toString()) {
    throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
  }

  const wasRated = RATED_REVIEW_STATUSES.includes(review.status);
  const willBeRated = RATED_REVIEW_STATUSES.includes(input.status);

  review.status = input.status;
  review.moderatedBy = auth.userId;
  review.moderatedAt = new Date();
  review.moderationNote = input.note ?? null;

  await review.save();

  /* Hiding a review must remove it from the average, and restoring it must put
     it back — otherwise moderation silently rewrites a doctor's score. */
  if (wasRated && !willBeRated) {
    await applyRatingDelta(review.doctor, { [review.rating]: -1 }, -review.rating, -1);
  } else if (!wasRated && willBeRated) {
    await applyRatingDelta(review.doctor, { [review.rating]: 1 }, review.rating, 1);
  }

  void recordAudit({
    actor,
    action: 'review.moderated',
    targetType: 'Review',
    targetId: review._id,
    changes: [{ field: 'status', from: wasRated ? 'published' : 'hidden', to: input.status }],
    ...(input.note ? { targetLabel: input.note } : {}),
  });

  return toReviewDTO(review);
}

/**
 * Mark a review helpful.
 *
 * `$addToSet` on the voter list plus a recomputed count, so one person cannot
 * inflate it by clicking repeatedly — the vote is idempotent by construction.
 */
export async function markHelpful(auth: AuthContext, reviewId: string) {
  const id = toObjectId(reviewId, 'reviewId');

  const result = await Review.findOneAndUpdate(
    { _id: id, client: { $ne: auth.userId } },
    { $addToSet: { helpfulBy: auth.userId } },
    { new: true, select: '+helpfulBy' },
  );

  if (!result) {
    /* Either it does not exist, or the caller wrote it — voting for your own
       review is not an error worth explaining. */
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that review.');
  }

  result.helpfulCount = result.helpfulBy.length;
  await result.save();

  return { reviewId: result._id.toString(), helpfulCount: result.helpfulCount };
}
