import { cn } from '@/lib/cn';

/**
 * Loading placeholders.
 *
 * Skeletons rather than a centred spinner, because they preserve layout: the
 * page does not jump when real content arrives. A spinner followed by a
 * full-page reflow is the single most common cause of a mis-click on a slow
 * connection — the button the user aimed at moves out from under them.
 *
 * For that to work the skeleton has to be roughly the size of what replaces it,
 * which is why the shapes below are specific rather than generic boxes.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      /* `aria-hidden` plus a `role="status"` on the container: announcing every
         individual bar would flood a screen reader with noise. */
      aria-hidden
      className={cn(
        'relative block overflow-hidden rounded-md bg-surface-sunken',
        /* The shimmer is a translated gradient rather than an opacity pulse —
           it stays on the compositor and reads as "working" rather than
           "broken". */
        'after:absolute after:inset-0 after:bg-shimmer after:animate-shimmer after:content-[""]',
        className,
      )}
    />
  );
}

/** Wraps a group of skeletons and announces the loading state once. */
export function SkeletonGroup({
  label = 'Loading content',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn(
            'h-3.5',
            /* The last line is short, the way a real paragraph ends. A block of
               equal-width bars reads as a table, not prose. */
            index === lines - 1 ? 'w-2/5' : index % 3 === 1 ? 'w-11/12' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}

/** Matches the shape of a pet or appointment card. */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-4">
        <Skeleton className="size-12 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
      <div className="mt-4 space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </div>
    </div>
  );
}

export function SkeletonStatTile() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-start gap-4">
        <Skeleton className="size-10 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    </div>
  );
}

/** Table placeholder. `columns` should match the real header count. */
export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex gap-4 border-b border-border bg-surface-sunken px-4 py-3">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 border-b border-border px-4 py-4 last:border-0">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton key={columnIndex} className="h-3.5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
