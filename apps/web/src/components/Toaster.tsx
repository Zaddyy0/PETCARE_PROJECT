import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { selectToasts, toastDismissed, type Toast } from '@/app/slices/toastSlice';
import { cn } from '@/lib/cn';
import { respectMotion, toastItem } from '@/lib/motion';

const TONES = {
  success: { bar: 'bg-success', icon: 'text-success', emoji: '✓' },
  error: { bar: 'bg-danger', icon: 'text-danger', emoji: '!' },
  warning: { bar: 'bg-warning', icon: 'text-warning', emoji: '!' },
  info: { bar: 'bg-info', icon: 'text-info', emoji: 'i' },
} as const;

/**
 * Toast stack.
 *
 * Rendered in a portal at the document root so no ancestor's `overflow` or
 * `transform` can clip it — a toast raised from inside a modal must still
 * appear above everything.
 *
 * The container is an `aria-live` region, which is what actually makes a toast
 * accessible: a visually-positioned div is invisible to a screen reader no
 * matter how prominent it looks. `polite` rather than `assertive` so it waits
 * for a natural pause instead of interrupting mid-sentence.
 */
export function Toaster() {
  const toasts = useAppSelector(selectToasts);

  return createPortal(
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      /* `pointer-events-none` on the container, re-enabled per toast: the
         empty space in this column must not swallow clicks on the page
         underneath. */
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dispatch = useAppDispatch();
  const reduced = useReducedMotion();
  const tone = TONES[toast.tone];

  /* Auto-dismiss. `duration: null` means it stays until dismissed, which is
     right for anything carrying instructions. */
  useEffect(() => {
    if (toast.duration === null) return;

    const timer = setTimeout(() => dispatch(toastDismissed(toast.id)), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, dispatch]);

  return (
    <motion.div
      layout
      variants={respectMotion(toastItem, reduced)}
      initial="hidden"
      animate="visible"
      exit="exit"
      className={cn(
        'pointer-events-auto relative flex w-full max-w-sm gap-3 overflow-hidden',
        'rounded-xl border border-border bg-surface-raised p-3.5 pl-4 shadow-lg',
      )}
    >
      {/* A coloured edge rather than a tinted background: the tint reduces text
          contrast, the bar carries the same meaning for free. */}
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-1', tone.bar)} />

      <span
        aria-hidden
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold',
          'bg-current/10',
          tone.icon,
        )}
      >
        {tone.emoji}
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-content text-pretty">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs leading-relaxed text-content-muted text-pretty">
            {toast.description}
          </p>
        )}
        {toast.action && (
          <a
            href={toast.action.href ?? '#'}
            className="mt-1.5 inline-block text-xs font-semibold text-primary hover:underline"
          >
            {toast.action.label}
          </a>
        )}
      </div>

      <button
        type="button"
        onClick={() => dispatch(toastDismissed(toast.id))}
        aria-label="Dismiss notification"
        className="-mr-1 -mt-1 grid size-7 shrink-0 place-items-center rounded-md text-content-subtle transition-colors hover:bg-surface-hover hover:text-content"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </motion.div>
  );
}
