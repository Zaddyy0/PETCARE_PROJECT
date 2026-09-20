/**
 * Response helpers.
 *
 * Every endpoint returns through one of these, so the envelope is identical
 * everywhere and `requestId` is never forgotten — it is read off the response
 * locals rather than being passed by each controller.
 */

import type { Response } from 'express';
import type { ApiSuccess, CursorPaginated, Paginated, PaginationMeta } from '@pawsitive/shared';

function requestIdOf(res: Response): string {
  return (res.locals['requestId'] as string | undefined) ?? 'unknown';
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = 'OK',
  statusCode = 200,
  meta?: Record<string, unknown>,
): Response<ApiSuccess<T>> {
  const body: ApiSuccess<T> = {
    success: true,
    message,
    data,
    requestId: requestIdOf(res),
  };

  if (meta) body.meta = meta;

  return res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T, message = 'Created'): Response {
  return sendSuccess(res, data, message, 201);
}

/**
 * 204 has no body by definition, so there is nothing to wrap.
 *
 * Used for idempotent deletes and for actions whose result the client already
 * knows — returning the deleted object invites clients to depend on it.
 */
export function sendNoContent(res: Response): Response {
  return res.status(204).send();
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  pagination: PaginationMeta,
  message = 'OK',
): Response<ApiSuccess<Paginated<T>>> {
  return sendSuccess(res, { items, pagination }, message);
}

export function sendCursorPaginated<T>(
  res: Response,
  items: T[],
  nextCursor: string | null,
  message = 'OK',
): Response<ApiSuccess<CursorPaginated<T>>> {
  return sendSuccess(res, { items, nextCursor, hasMore: nextCursor !== null }, message);
}
