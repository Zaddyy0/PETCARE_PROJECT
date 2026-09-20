import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/lib/cn';

/**
 * Form fields.
 *
 * The wiring here is the point. Every field generates one id and uses it to
 * connect four things that are usually left disconnected:
 *
 *   • `<label for>` → the input, so clicking the label focuses it
 *   • `aria-describedby` → the hint, so it is read out
 *   • `aria-errormessage` + `aria-invalid` → the error
 *   • `role="alert"` on the error, so a screen reader announces it on appearance
 *
 * Doing this by hand per form is how half the fields end up unlabelled. Here it
 * is impossible to forget, because the component owns it.
 */

interface FieldShellProps {
  id: string;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** Rendered instead of the label row — used by checkboxes. */
  bare?: boolean;
  children: ReactNode;
  className?: string;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-content">
          {label}
          {required && (
            <>
              {/* The asterisk is decorative; the input's own `required`
                  attribute is what assistive tech reads. */}
              <span aria-hidden className="ml-0.5 text-danger">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
      )}

      {children}

      {/* The hint is hidden once there is an error — two competing messages
          under one field is noise, and the error is the one that matters. */}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-content-subtle">
          {hint}
        </p>
      )}

      <AnimatePresence mode="wait">
        {error && (
          <motion.p
            key={error}
            id={`${id}-error`}
            /* `alert` so the message is announced the moment it appears, not
               only when focus happens to reach it. */
            role="alert"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="flex items-start gap-1 text-xs font-medium text-danger"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="mt-px size-3.5 shrink-0 fill-current">
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 4.5h1.5v5h-1.5v-5Zm0 6h1.5V12h-1.5v-1.5Z" />
            </svg>
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Shared visual treatment, so an input, select and textarea are identical. */
const CONTROL = [
  'w-full bg-surface text-content placeholder:text-content-subtle',
  'border border-border rounded-lg',
  'transition-[border-color,box-shadow] duration-fast ease-out',
  'hover:border-border-strong',
  /* The ring is drawn with box-shadow rather than `outline`, so it follows the
     border radius exactly on every browser. */
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60',
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger/25',
].join(' ');

/* -------------------------------------------------------------------------- */
/*                                    Input                                   */
/* -------------------------------------------------------------------------- */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  hint?: string;
  error?: string;
  leadingIcon?: ReactNode;
  trailingSlot?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingIcon, trailingSlot, className, containerClassName, id, required, ...rest },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        {leadingIcon && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle [&>svg]:size-4"
          >
            {leadingIcon}
          </span>
        )}

        <input
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          /* Both are set, because support differs: `aria-errormessage` is the
             correct modern attribute, `aria-describedby` is what older screen
             readers actually honour. */
          aria-errormessage={error ? `${fieldId}-error` : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(
            CONTROL,
            'h-10 px-3 text-sm',
            leadingIcon && 'pl-9',
            trailingSlot && 'pr-10',
            className,
          )}
          {...rest}
        />

        {trailingSlot && (
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2">{trailingSlot}</span>
        )}
      </div>
    </FieldShell>
  );
});

/* -------------------------------------------------------------------------- */
/*                                  Textarea                                  */
/* -------------------------------------------------------------------------- */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Shows a live `n / max` counter. Requires `maxLength`. */
  showCount?: boolean;
  containerClassName?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, showCount, className, containerClassName, id, required, maxLength, value, ...rest },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;
  const length = typeof value === 'string' ? value.length : 0;

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        <textarea
          ref={ref}
          id={fieldId}
          required={required}
          maxLength={maxLength}
          value={value}
          rows={4}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? `${fieldId}-error` : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(CONTROL, 'resize-y px-3 py-2 text-sm leading-relaxed', className)}
          {...rest}
        />

        {showCount && maxLength && (
          <span
            /* `aria-live="off"`: a counter that announces on every keystroke is
               unusable with a screen reader. Sighted users get the visual cue,
               and the `maxLength` attribute is the real guard. */
            aria-live="off"
            className={cn(
              'pointer-events-none absolute bottom-2 right-2 rounded bg-surface/80 px-1 text-[0.6875rem] tabular-nums',
              length > maxLength * 0.9 ? 'text-warning' : 'text-content-subtle',
            )}
          >
            {length} / {maxLength}
          </span>
        )}
      </div>
    </FieldShell>
  );
});

/* -------------------------------------------------------------------------- */
/*                                   Select                                   */
/* -------------------------------------------------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
  containerClassName?: string;
}

/**
 * A native `<select>`, deliberately.
 *
 * A custom listbox would match the design more closely, but the native control
 * gets mobile's wheel picker, full keyboard support, type-ahead and screen
 * reader semantics for free — all of which a hand-rolled version reimplements
 * badly. The only concession is hiding the default arrow and drawing our own.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, className, containerClassName, id, required, ...rest },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <FieldShell
      id={fieldId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={containerClassName}
    >
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? `${fieldId}-error` : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(CONTROL, 'h-10 appearance-none pl-3 pr-9 text-sm', className)}
          {...rest}
        >
          {placeholder && (
            /* `value=""` plus `required` makes the placeholder fail native
               validation, so the browser blocks submit until a real choice is
               made. */
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>

        <svg
          aria-hidden
          viewBox="0 0 16 16"
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-content-subtle"
        >
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </FieldShell>
  );
});

/* -------------------------------------------------------------------------- */
/*                                  Checkbox                                  */
/* -------------------------------------------------------------------------- */

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: string;
  error?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const generated = useId();
  const fieldId = id ?? generated;

  return (
    <div className="flex flex-col gap-1.5">
      {/* The whole row is the label, so the generous tap target includes the
          text — important on touch, where a 16px box alone is a miss. */}
      <label htmlFor={fieldId} className="group flex cursor-pointer items-start gap-2.5">
        <input
          ref={ref}
          id={fieldId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(
            'mt-0.5 size-4 shrink-0 cursor-pointer rounded border-border bg-surface',
            'text-primary accent-primary',
            'transition-shadow duration-fast focus-visible:ring-2 focus-visible:ring-primary/25',
            error && 'border-danger',
            className,
          )}
          {...rest}
        />
        <span className="text-sm leading-snug text-content">{label}</span>
      </label>

      {hint && !error && (
        <p id={`${fieldId}-hint`} className="ml-6.5 text-xs text-content-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} role="alert" className="ml-6.5 text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
});
