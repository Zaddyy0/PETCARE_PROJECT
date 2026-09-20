import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import * as notificationService from '../services/notification.service.js';
import { toNotificationDTO } from '../dto/notification.dto.js';
import { Notification } from '../models/notification.model.js';
import { requireAuth } from '../middleware/authorize.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCursorPaginated, sendSuccess } from '../utils/api-response.js';
import {
  buildCursorResult,
  decodeCursor,
  resolveCursorLimit,
} from '../utils/pagination.js';

/**
 * Cursor-paginated, not offset-paginated.
 *
 * Notifications grow at the head, so offset paging double-serves and skips
 * rows as new ones arrive mid-scroll: the user sees the same item twice and
 * misses another entirely. An `_id` range is stable against concurrent writes.
 */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);

  const limit = resolveCursorLimit(Number(req.query['limit'] as string | undefined));
  const cursor = decodeCursor(req.query['cursor'] as string | undefined);
  const unreadOnly = req.query['unreadOnly'] === 'true';

  const filter: Record<string, unknown> = { user: auth.userId };
  if (cursor) filter['_id'] = { $lt: cursor };
  if (unreadOnly) filter['readAt'] = null;

  /* Over-fetch by one to know whether another page exists, without a second
     count query over the whole collection. */
  const rows = await Notification.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);

  const result = buildCursorResult(
    rows.map((row) => toNotificationDTO(row)),
    limit,
  );

  sendCursorPaginated(res, result.items, result.nextCursor, 'Notifications loaded.');
});

export const counts = asyncHandler(async (req: Request, res: Response) => {
  const result = await notificationService.getCounts(requireAuth(req).userId);
  sendSuccess(res, result, 'Counts loaded.');
});

export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const id = req.params['id'] as string;

  if (!Types.ObjectId.isValid(id)) {
    sendSuccess(res, { updated: false }, 'Nothing to update.');
    return;
  }

  const updated = await notificationService.markRead(auth.userId, new Types.ObjectId(id));

  /* Idempotent: marking an already-read notification is a success, not a 404.
     The client fires these optimistically on scroll. */
  sendSuccess(res, { updated }, updated ? 'Marked as read.' : 'Already read.');
});

export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const updated = await notificationService.markAllRead(requireAuth(req).userId);
  sendSuccess(res, { updated }, `${updated} notification${updated === 1 ? '' : 's'} marked as read.`);
});
