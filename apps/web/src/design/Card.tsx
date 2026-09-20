import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import type { MetricValue } from '@pawsitive/shared';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

/* `HTMLMotionProps` rather than `HTMLAttributes` — Framer replaces the drag and
   animation handlers with its own signatures, so the two conflict. */
export interface CardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  /** Lifts on hover. Only for cards that are actually clickable. */
  interactive?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const PADDING = {
  none: '',
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-6 sm:p-8',
} as const;

export function Card({
  interactive = false,
  padding = 'md',
  className,
  children,
  ...rest
}: CardProps) {
  const reduced = useReducedMotion();

  return (
    <motion.div
      /* Lift only when interactive. A static card that moves under the cursor
         implies it can be clicked, which is a small lie the user pays for by
         clicking it. */
      whileHover={interactive && !reduced ? { y: -3 } : undefined}
      transition={spring}
      className={cn(
        'rounded-xl border border-border bg-surface shadow-sm',
        interactive && 'cursor-pointer transition-shadow duration-base hover:shadow-lg',
        PADDING[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {/* `h3` rather than a styled div — a card title is a real heading, and
            screen reader users navigate by heading. */}
        <h3 className="text-base font-semibold text-content">{title}</h3>
        {description && (
          <p className="mt-0.5 text-sm text-content-muted text-pretty">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * A metric tile.
 *
 * `tabular-nums` on the value is the detail that matters: without it, a number
 * counting up or refreshing makes the tile jitter as digit widths change.
 */
export function StatTile({
  label,
  value,
  change,
  icon,
  tone = 'primary',
  className,
}: {
  label: string;
  value: ReactNode;
  /**
   * The shared `MetricValue` straight from the analytics payload.
   *
   * Taking the contract type rather than a locally-invented
   * `{ percent, trend }` means the API's shape is the only shape — there is no
   * mapping step for a caller to get wrong, and `changePercent: null` (a zero
   * baseline) flows through with its meaning intact.
   */
  change?: MetricValue | undefined;
  icon?: ReactNode;
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}) {
  const TONES = {
    primary: 'bg-primary-soft text-primary',
    accent: 'bg-accent-soft text-accent',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  } as const;

  return (
    <Card className={cn('flex items-start gap-4', className)}>
      {icon && (
        <div
          aria-hidden
          className={cn('grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-5', TONES[tone])}
        >
          {icon}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-content-muted">{label}</p>

        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-content">
            {value}
          </span>

          {change && change.changePercent !== null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums',
                change.trend === 'up' && 'text-success',
                change.trend === 'down' && 'text-danger',
                change.trend === 'flat' && 'text-content-subtle',
              )}
            >
              {change.trend !== 'flat' && (
                <svg aria-hidden viewBox="0 0 12 12" className="size-3 fill-current">
                  {change.trend === 'up' ? (
                    <path d="M6 2.5 10 8H2l4-5.5Z" />
                  ) : (
                    <path d="M6 9.5 2 4h8L6 9.5Z" />
                  )}
                </svg>
              )}
              {Math.abs(change.changePercent)}%
              {/* The arrow alone does not convey direction to a screen
                  reader. */}
              <span className="sr-only">
                {change.trend === 'up' ? 'increase' : change.trend === 'down' ? 'decrease' : 'no change'}
              </span>
            </span>
          )}

          {/* A zero baseline would otherwise render as an infinite percentage. */}
          {change && change.changePercent === null && (
            <span className="text-xs font-medium text-content-subtle">new</span>
          )}
        </div>
      </div>
    </Card>
  );
}
