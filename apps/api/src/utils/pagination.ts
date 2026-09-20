/**
 * Pagination helpers.
 *
 * The previous API had none: `getAppointments` returned every appointment a
 * user had ever had, forever. That is fine with three rows in development and
 * becomes a timeout with three years of history. Every list endpoint here is
 * paginated, and the page size is capped in the shared schema so a crafted
 * `?limit=999999` cannot turn one request into a full collection scan.
 */

import type { CursorPaginated, PaginationMeta } from '@pawsitive/shared';
import { LIMITS } from '@pawsitive/shared';
import { Types } from 'mongoose';

export interface OffsetPageInput {
  page?: number;
  limit?: number;
}

export interface ResolvedPage {
  page: number;
  limit: number;
  skip: number;
}

export function resolvePage(input: OffsetPageInput): ResolvedPage {
  const page = Math.max(1, Math.trunc(input.page ?? 1));
  const limit = Math.min(
    LIMITS.MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(input.limit ?? LIMITS.DEFAULT_PAGE_SIZE)),
  );

  return { page, limit, skip: (page - 1) * limit };
}

export function buildPaginationMeta(
  total: number,
  { page, limit }: Pick<ResolvedPage, 'page' | 'limit'>,
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / limit));

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}

/**
 * Turn `sort`/`order` into a Mongo sort object.
 *
 * `allowed` is a whitelist, not a suggestion. Passing a user-supplied field
 * straight into `.sort()` lets a caller sort by any field in the document —
 * including ones that are not indexed, turning a cheap paginated query into an
 * in-memory sort of the whole collection.
 *
 * `_id` is appended as a tiebreaker. Without one, two documents with the same
 * sort value can come back in a different order on each page, so a row is
 * shown twice and another is never shown at all.
 */
export function buildSort<TField extends string>(
  field: string | undefined,
  order: 'asc' | 'desc' | undefined,
  allowed: readonly TField[],
  fallback: TField,
): Record<string, 1 | -1> {
  const safeField = allowed.includes(field as TField) ? (field as TField) : fallback;
  const direction = order === 'asc' ? 1 : -1;

  return { [safeField]: direction, _id: direction };
}

/* -------------------------------------------------------------------------- */
/*                             Cursor pagination                              */
/* -------------------------------------------------------------------------- */

/**
 * Cursor paging over `_id`, for feeds that grow at the head.
 *
 * ObjectIds are monotonically increasing by creation time, so "everything older
 * than this id" is both a stable cursor and an index-backed range scan — no
 * `skip`, which the server must walk item by item and which gets slower the
 * deeper you page.
 *
 * The cursor is opaque base64url so clients treat it as a token rather than
 * building one themselves.
 */
export function encodeCursor(id: Types.ObjectId | string): string {
  return Buffer.from(String(id)).toString('base64url');
}

export function decodeCursor(cursor: string | null | undefined): Types.ObjectId | null {
  if (!cursor) return null;

  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return Types.ObjectId.isValid(decoded) ? new Types.ObjectId(decoded) : null;
  } catch {
    /* A malformed cursor means "start from the beginning", not a 500. */
    return null;
  }
}

/**
 * Build a cursor-paginated result from a slice fetched with `limit + 1` rows.
 *
 * Over-fetching by exactly one is how we know whether another page exists
 * without running a second `countDocuments` over the whole collection.
 */
export function buildCursorResult<TItem extends { id: string }>(
  rows: TItem[],
  limit: number,
): CursorPaginated<TItem> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(last.id) : null,
    hasMore,
  };
}

export function resolveCursorLimit(limit: number | undefined): number {
  return Math.min(LIMITS.MAX_CURSOR_PAGE_SIZE, Math.max(1, Math.trunc(limit ?? 20)));
}

/**
 * Escape a user string before putting it in a `$regex`.
 *
 * Unescaped, a search for `(((((((((a` is a catastrophic-backtracking regex
 * that pins a CPU core — a denial of service from a search box.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive "contains" matcher for a whitelisted set of fields. */
export function buildSearchFilter(
  search: string | undefined,
  fields: readonly string[],
): Record<string, unknown> | null {
  const trimmed = search?.trim();
  if (!trimmed || fields.length === 0) return null;

  const pattern = new RegExp(escapeRegex(trimmed), 'i');
  return { $or: fields.map((field) => ({ [field]: pattern })) };
}
