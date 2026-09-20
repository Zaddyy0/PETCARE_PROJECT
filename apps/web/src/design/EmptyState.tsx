import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { fadeUp } from '@/lib/motion';

export interface EmptyStateProps {
  /** A large emoji or icon. Decorative — the copy carries the meaning. */
  illustration?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** A quieter variant for an empty panel inside a populated page. */
  compact?: boolean;
  className?: string;
}

/**
 * The empty state.
 *
 * Worth treating as a first-class screen rather than an afterthought: it is
 * the *first* thing every new user sees on every page. "No pets yet" with a
 * button to add one teaches the product; a blank area teaches nothing and reads
 * as a failed load.
 *
 * The description always says what to do next, not just that nothing is there.
 */
export function EmptyState({
  illustration,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      {illustration && (
        <div
          aria-hidden
          className={cn(
            'grid place-items-center rounded-2xl bg-surface-sunken',
            compact ? 'size-12 text-2xl' : 'size-20 text-4xl',
          )}
        >
          {illustration}
        </div>
      )}

      <div className="max-w-sm">
        <h3
          className={cn(
            'font-semibold text-content text-balance',
            compact ? 'text-sm' : 'text-lg',
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              'mt-1 text-content-muted text-pretty',
              compact ? 'text-xs' : 'text-sm leading-relaxed',
            )}
          >
            {description}
          </p>
        )}
      </div>

      {action && <div className={compact ? 'mt-1' : 'mt-2'}>{action}</div>}
    </motion.div>
  );
}

/**
 * The error state.
 *
 * Distinct from `EmptyState` on purpose. "Nothing here yet" and "we could not
 * load this" are completely different situations, and showing an empty state
 * for a failed request makes users believe their data is gone.
 *
 * Always offers a retry, and shows the request id when there is one — it is the
 * single most useful thing a user can quote in a support message.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  requestId,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  requestId?: string | undefined;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}
    >
      <div aria-hidden className="grid size-20 place-items-center rounded-2xl bg-danger-soft text-4xl">
        😿
      </div>

      <div className="max-w-sm">
        <h3 className="text-lg font-semibold text-content text-balance">{title}</h3>
        {description && (
          <p className="mt-1 text-sm leading-relaxed text-content-muted text-pretty">{description}</p>
        )}
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 h-10 rounded-lg bg-primary px-5 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
        >
          Try again
        </button>
      )}

      {requestId && (
        <p className="mt-2 font-mono text-[0.6875rem] text-content-subtle">
          Reference: {requestId}
        </p>
      )}
    </div>
  );
}
