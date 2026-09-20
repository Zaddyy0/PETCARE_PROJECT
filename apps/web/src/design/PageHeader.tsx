import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * The page header.
 *
 * Owns the single `h1` per page, so no screen accidentally ships two or none.
 * The breadcrumb is a real `nav` with an ordered list, which is what lets a
 * screen reader announce depth rather than reading a row of slashes.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: {
  title: string;
  description?: string;
  breadcrumbs?: { label: string; to?: string }[];
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('mb-6', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2">
          <ol className="flex flex-wrap items-center gap-1.5 text-xs text-content-subtle">
            {breadcrumbs.map((crumb, index) => {
              const last = index === breadcrumbs.length - 1;

              return (
                <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
                  {crumb.to && !last ? (
                    <Link to={crumb.to} className="transition-colors hover:text-content">
                      {crumb.label}
                    </Link>
                  ) : (
                    /* The current page is marked, not linked. */
                    <span aria-current={last ? 'page' : undefined} className={last ? 'text-content-muted' : ''}>
                      {crumb.label}
                    </span>
                  )}
                  {!last && <span aria-hidden>/</span>}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-display-sm text-content text-balance">{title}</h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-content-muted text-pretty">{description}</p>
          )}
        </div>

        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** A section heading inside a page. Renders an `h2`, below the page `h1`. */
export function SectionHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-content">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-content-muted text-pretty">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
