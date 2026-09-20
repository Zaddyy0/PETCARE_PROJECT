import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { backdrop, modalPanel, respectMotion } from '@/lib/motion';
import { IconButton } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Blocks backdrop and Escape dismissal. For destructive confirmations. */
  dismissible?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

/**
 * An accessible modal dialog.
 *
 * A dialog is one of the easiest components to get *visually* right and
 * functionally wrong. The four things below are what separate a real dialog
 * from a styled div, and each of them is a genuine barrier if missing:
 *
 *   1. **Focus moves in on open** and returns to the trigger on close.
 *      Without it, a keyboard user's focus is left behind on the page under the
 *      overlay, tabbing through content they cannot see.
 *   2. **Focus is trapped** while open, so Tab cycles within the dialog.
 *   3. **Escape closes it**, which is what every user already expects.
 *   4. **Background scroll is locked**, or the page slides behind the panel.
 *
 * Rendered through a portal so a parent's `overflow: hidden` or `transform`
 * cannot clip it or break its fixed positioning.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  dismissible = true,
  footer,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();

  const handleClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  /* ---- Remember and restore focus. ------------------------------------- */
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    /* One frame later, so the panel exists in the DOM before we reach into it. */
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;

      /**
       * Prefer the first input, then the panel itself — *not* the first button.
       * Landing on "Cancel" or the close X means a keyboard user's first
       * keystroke could dismiss the dialog they just opened.
       */
      const target =
        panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>('input:not([type="hidden"]), textarea, select') ??
        panel;

      target.focus({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(frame);
      /* Restoring focus is what makes repeated open/close usable by keyboard. */
      previouslyFocused.current?.focus({ preventScroll: true });
    };
  }, [open]);

  /* ---- Escape to close, Tab to cycle. ---------------------------------- */
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;

      /* Queried on every Tab rather than cached: the dialog's contents change
         as fields appear, validate and disable, so a stale list would trap
         focus on an element that is no longer reachable. */
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);

      if (focusable.length === 0) return;

      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;

      /* Wrap at both ends, which is the trap. */
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  /* ---- Lock background scroll. ----------------------------------------- */
  useEffect(() => {
    if (!open) return;

    const { overflow, paddingRight } = document.body.style;

    /**
     * Compensate for the scrollbar's width when hiding it.
     *
     * Setting `overflow: hidden` removes the scrollbar, which widens the
     * viewport by ~15px and shifts the whole page sideways as the modal opens.
     * Adding that width back as padding keeps everything still.
     */
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            variants={respectMotion(backdrop, reduced)}
            initial="hidden"
            animate="visible"
            exit="exit"
            /* The backdrop is the click target for dismissal, and is hidden
               from assistive tech — the dialog's own Escape handling and close
               button are the accessible paths. */
            aria-hidden
            onClick={handleClose}
            className="absolute inset-0 bg-sand-950/55 backdrop-blur-sm"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            variants={respectMotion(modalPanel, reduced)}
            initial="hidden"
            animate="visible"
            exit="exit"
            className={cn(
              'relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden bg-surface shadow-xl',
              /* A bottom sheet on phones, a centred panel from `sm` up — the
                 same component, the pattern each form factor expects. */
              'rounded-t-2xl sm:rounded-2xl',
              SIZES[size],
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="text-lg font-semibold text-content text-balance">
                  {title}
                </h2>
                {description && (
                  <p id={descriptionId} className="mt-1 text-sm text-content-muted text-pretty">
                    {description}
                  </p>
                )}
              </div>

              {dismissible && (
                <IconButton
                  label="Close dialog"
                  size="sm"
                  onClick={onClose}
                  icon={
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75">
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  }
                />
              )}
            </header>

            {/* Only the body scrolls, so the header and footer stay reachable
                on a long form. */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

            {footer && (
              <footer className="flex items-center justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-4">
                {footer}
              </footer>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Confirmation dialog for a destructive action.
 *
 * `dismissible={false}` by default: a misplaced click on the backdrop should
 * not silently cancel something the user was told to confirm. They must choose.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-10 rounded-lg border border-border px-4 text-sm font-medium text-content transition-colors hover:bg-surface-hover disabled:opacity-55"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            /* Autofocused, because the user opened this dialog intending to
               act — and it is a deliberate exception to the "never focus a
               button" rule above, since here the primary action *is* the
               point. */
            data-autofocus
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              'h-10 rounded-lg px-4 text-sm font-medium transition-colors disabled:opacity-55',
              tone === 'danger'
                ? 'bg-danger text-danger-fg hover:bg-danger-hover'
                : 'bg-primary text-primary-fg hover:bg-primary-hover',
            )}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-content-muted text-pretty">{message}</p>
    </Modal>
  );
}
