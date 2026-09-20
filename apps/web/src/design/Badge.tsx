import type { ReactNode } from 'react';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONE,
  type AppointmentStatus,
} from '@pawsitive/shared';
import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-content-muted border-border',
  primary: 'bg-primary-soft text-primary border-primary/20',
  accent: 'bg-accent-soft text-accent border-accent/20',
  success: 'bg-success-soft text-success border-success/20',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-danger-soft text-danger border-danger/20',
  info: 'bg-info-soft text-info border-info/20',
};

export interface BadgeProps {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  /** Adds a leading dot. Useful where the label alone reads as plain text. */
  dot?: boolean;
  /** Animates the dot. For genuinely live states only — `in_progress`. */
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone = 'neutral',
  size = 'md',
  dot = false,
  pulse = false,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[0.6875rem]' : 'px-2.5 py-1 text-xs',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-full bg-current', pulse && 'animate-breathe')}
        />
      )}
      {children}
    </span>
  );
}

/**
 * The badge for an appointment status.
 *
 * Both the label and the tone come from `@pawsitive/shared`, so a new status
 * added to the state machine renders correctly here without touching this file
 * — and, more importantly, the colour a status shows in the UI cannot drift
 * from the meaning the backend assigns it.
 */
export function StatusBadge({
  status,
  size = 'md',
}: {
  status: AppointmentStatus;
  size?: 'sm' | 'md';
}) {
  return (
    <Badge
      tone={APPOINTMENT_STATUS_TONE[status]}
      size={size}
      dot
      /* Only an in-progress consultation is actually happening right now. */
      pulse={status === 'in_progress'}
    >
      {APPOINTMENT_STATUS_LABELS[status]}
    </Badge>
  );
}
