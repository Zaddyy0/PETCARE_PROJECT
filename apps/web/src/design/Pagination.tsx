import type { PaginationMeta } from '@pawsitive/shared';
import { cn } from '@/lib/cn';

/**
 * Pagination controls.
 *
 * Renders nothing for a single page — a disabled "1 of 1" control is visual
 * noise that implies there is more to see.
 *
 * The page window is elided around the current page rather than listing every
 * page, so a 40-page result does not produce a 40-button row. `1 … 7 8 9 … 40`
 * keeps the first and last reachable, which is what people actually jump to.
 */
export function Pagination({
  pagination,
  onPageChange,
  className,
}: {
  pagination: PaginationMeta;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  const { page, totalPages, total, limit } = pagination;

  if (totalPages <= 1) return null;

  const pages = windowedPages(page, totalPages);

  const firstRow = (page - 1) * limit + 1;
  const lastRow = Math.min(page * limit, total);

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-wrap items-center justify-between gap-3 pt-4', className)}
    >
      {/* The count is the more useful half of this control — it tells you how
          much is there, which the page numbers do not. */}
      <p className="text-xs tabular-nums text-content-subtle">
        Showing <span className="font-medium text-content-muted">{firstRow}</span>–
        <span className="font-medium text-content-muted">{lastRow}</span> of{' '}
        <span className="font-medium text-content-muted">{total}</span>
      </p>

      <div className="flex items-center gap-1">
        <PageButton
          label="Previous page"
          disabled={!pagination.hasPrevPage}
          onClick={() => onPageChange(page - 1)}
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M10 4l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </PageButton>

        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <span
              key={`gap-${index}`}
              aria-hidden
              className="px-1 text-xs text-content-subtle"
            >
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              onClick={() => onPageChange(entry)}
              aria-current={entry === page ? 'page' : undefined}
              aria-label={`Page ${entry}`}
              className={cn(
                'h-8 min-w-8 rounded-md px-2 text-xs font-medium tabular-nums transition-colors',
                entry === page
                  ? 'bg-primary text-primary-fg'
                  : 'text-content-muted hover:bg-surface-hover hover:text-content',
              )}
            >
              {entry}
            </button>
          ),
        )}

        <PageButton
          label="Next page"
          disabled={!pagination.hasNextPage}
          onClick={() => onPageChange(page + 1)}
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </PageButton>
      </div>
    </nav>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-8 place-items-center rounded-md text-content-muted transition-colors hover:bg-surface-hover hover:text-content disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/**
 * `1 … 7 8 9 … 40` — first, last, and a window around the current page.
 *
 * The window is widened at the edges so the control does not change width as
 * you page through: at page 1 there is no room on the left, so the extra slots
 * go right.
 */
function windowedPages(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages: (number | 'gap')[] = [1];

  let start = Math.max(2, current - 1);
  let end = Math.min(total - 1, current + 1);

  /* Widen toward the middle when the window is clamped by an edge. */
  if (current <= 3) end = 4;
  if (current >= total - 2) start = total - 3;

  if (start > 2) pages.push('gap');

  for (let page = start; page <= end; page += 1) pages.push(page);

  if (end < total - 1) pages.push('gap');

  pages.push(total);
  return pages;
}
