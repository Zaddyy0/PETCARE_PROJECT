import type { Request, Response } from 'express';
import type {
  CreateReviewInput,
  ModerateReviewInput,
  ReviewListQueryInput,
  UpdateReviewInput,
} from '@pawsitive/shared';
import * as reviewService from '../services/review.service.js';
import { actorFromRequest } from '../services/audit.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { body, query } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/api-response.js';

/** Readable anonymously — a prospective client should see a doctor's reviews. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await reviewService.listReviews(
    req.auth ?? null,
    query<ReviewListQueryInput>(req),
  );
  sendPaginated(res, result.items, result.pagination, 'Reviews loaded.');
});

export const summary = asyncHandler(async (req: Request, res: Response) => {
  const result = await reviewService.getSummary(req.params['doctorId'] as string);
  sendSuccess(res, result, 'Rating summary loaded.');
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.createReview(requireAuth(req), body<CreateReviewInput>(req));
  sendCreated(res, review, 'Thanks for the review!');
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.updateReview(
    requireAuth(req),
    req.params['id'] as string,
    body<UpdateReviewInput>(req),
  );
  sendSuccess(res, review, 'Review updated.');
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const result = await reviewService.deleteOwnReview(requireAuth(req), req.params['id'] as string);
  sendSuccess(res, result, 'Review withdrawn.');
});

export const respond = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.respondToReview(
    requireAuth(req),
    req.params['id'] as string,
    body<{ comment: string }>(req).comment,
  );
  sendSuccess(res, review, 'Reply posted.');
});

export const moderate = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.moderateReview(
    requireAuth(req),
    req.params['id'] as string,
    body<ModerateReviewInput>(req),
    actorFromRequest(req),
  );
  sendSuccess(res, review, 'Review moderated.');
});

export const markHelpful = asyncHandler(async (req: Request, res: Response) => {
  const result = await reviewService.markHelpful(requireAuth(req), req.params['id'] as string);
  sendSuccess(res, result, 'Thanks for the feedback.');
});
