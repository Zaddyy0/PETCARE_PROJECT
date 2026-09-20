import { APP_NAME } from '@pawsitive/shared';
import { cn } from '@/lib/cn';

/**
 * The wordmark.
 *
 * `collapsed` renders the paw alone, for the narrow sidebar. The text is still
 * emitted to screen readers in that state — the icon on its own would announce
 * as nothing at all, so the app would have no accessible name in the nav.
 */
export function Logo({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex select-none items-center gap-2', className)}>
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-gradient text-base shadow-sm"
      >
        🐾
      </span>

      {collapsed ? (
        <span className="sr-only">{APP_NAME}</span>
      ) : (
        <span className="text-gradient text-lg font-bold tracking-tight">{APP_NAME}</span>
      )}
    </span>
  );
}
