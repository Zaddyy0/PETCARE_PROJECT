import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { forwardRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { Spinner } from './Spinner';

export type ButtonVariant =
  | 'primary'
  | 'accent'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'outline';

export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Extends `HTMLMotionProps`, not `ButtonHTMLAttributes`.
 *
 * Framer Motion redefines the drag and animation handlers with its own
 * signatures — `onDrag` takes a `PanInfo`, not a React `DragEvent` — so the two
 * prop sets genuinely conflict. `HTMLMotionProps<'button'>` is the button's
 * full attribute set with those handlers already replaced, which is exactly
 * what a `motion.button` accepts.
 */
export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /**
   * Shows a spinner and blocks interaction.
   *
   * Separate from `disabled` so the two can be told apart: a loading button is
   * temporarily busy, a disabled one is unavailable. They need different
   * `aria-` treatment and different copy.
   */
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  children?: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-fg hover:bg-primary-hover shadow-sm',
  accent: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface-sunken text-content hover:bg-surface-hover border border-border',
  ghost: 'text-content-muted hover:bg-surface-hover hover:text-content',
  danger: 'bg-danger text-danger-fg hover:bg-danger-hover shadow-sm',
  outline: 'border border-border-strong text-content hover:bg-surface-hover hover:border-primary',
};

/**
 * Heights are fixed per size rather than derived from padding.
 *
 * A row of buttons where one has an icon and another does not must still line
 * up; padding-only sizing makes them differ by a pixel or two, which is exactly
 * the kind of thing that looks "slightly off" without being identifiable.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[0.8125rem] gap-1.5 rounded-md',
  md: 'h-10 px-4 text-sm gap-2 rounded-lg',
  lg: 'h-12 px-6 text-[0.9375rem] gap-2.5 rounded-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    fullWidth = false,
    className,
    disabled,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const reduced = useReducedMotion();
  const isInert = disabled || loading;

  return (
    <motion.button
      ref={ref}
      /* Defaults to `button`. An unspecified `type` inside a form is `submit`,
         which makes every incidental button submit the form — a genuinely
         common and very confusing bug. */
      type={type}
      disabled={isInert}
      /* Announces the busy state to assistive technology, which cannot see
         the spinner. */
      aria-busy={loading || undefined}
      whileHover={isInert || reduced ? undefined : { scale: 1.015 }}
      whileTap={isInert || reduced ? undefined : { scale: 0.985 }}
      transition={spring}
      className={cn(
        'relative inline-flex select-none items-center justify-center font-medium',
        'transition-colors duration-fast ease-out',
        /* `disabled:` handles both states, since `loading` sets `disabled`. */
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {/**
       * The label stays mounted and is faded, rather than swapped for the
       * spinner. Replacing it would collapse the button's width mid-click and
       * shift everything around it.
       */}
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={size === 'lg' ? 'md' : 'sm'} />
        </span>
      )}

      <span
        className={cn(
          'inline-flex items-center',
          SIZES[size].includes('gap-1.5') ? 'gap-1.5' : size === 'lg' ? 'gap-2.5' : 'gap-2',
          loading && 'opacity-0',
        )}
      >
        {/* Icons are decorative — the label already carries the meaning. */}
        {leadingIcon && (
          <span aria-hidden className="shrink-0 [&>svg]:size-[1.125em]">
            {leadingIcon}
          </span>
        )}
        {children}
        {trailingIcon && (
          <span aria-hidden className="shrink-0 [&>svg]:size-[1.125em]">
            {trailingIcon}
          </span>
        )}
      </span>
    </motion.button>
  );
});

/* -------------------------------------------------------------------------- */

export interface IconButtonProps extends Omit<ButtonProps, 'leadingIcon' | 'trailingIcon' | 'fullWidth'> {
  /**
   * Required, not optional.
   *
   * An icon-only button is invisible to a screen reader without it, and making
   * it optional guarantees somebody ships one without. Typing it as required is
   * the only reliable enforcement.
   */
  label: string;
  icon: ReactNode;
}

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-8 rounded-md',
  md: 'size-10 rounded-lg',
  lg: 'size-12 rounded-lg',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', loading, className, disabled, ...rest },
  ref,
) {
  const reduced = useReducedMotion();
  const isInert = disabled || loading;

  return (
    <motion.button
      ref={ref}
      type="button"
      disabled={isInert}
      aria-label={label}
      /* A visible tooltip for sighted mouse users, since the label is not
         rendered. */
      title={label}
      aria-busy={loading || undefined}
      whileHover={isInert || reduced ? undefined : { scale: 1.06 }}
      whileTap={isInert || reduced ? undefined : { scale: 0.94 }}
      transition={spring}
      className={cn(
        'inline-grid place-items-center transition-colors duration-fast ease-out',
        'disabled:cursor-not-allowed disabled:opacity-55',
        VARIANTS[variant],
        ICON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : <span aria-hidden className="[&>svg]:size-[1.25em]">{icon}</span>}
    </motion.button>
  );
});
