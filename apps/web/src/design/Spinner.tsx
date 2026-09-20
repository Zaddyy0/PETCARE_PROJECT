import { cn } from '@/lib/cn';

export interface SpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
  /** Announced to assistive technology. Omit inside an `aria-busy` container. */
  label?: string;
}

const SIZES = {
  xs: 'size-3 border',
  sm: 'size-4 border-2',
  md: 'size-6 border-2',
  lg: 'size-9 border-[3px]',
} as const;

/**
 * A spinner built from a bordered circle rather than an SVG.
 *
 * `border-t-transparent` on a rounded element gives the gap; CSS rotation does
 * the rest. No SVG to download, and it inherits `currentColor`, so it is
 * automatically the right colour inside any button variant.
 */
export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  return (
    <span
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      className={cn(
        'inline-block animate-spin rounded-full border-current border-t-transparent',
        SIZES[size],
        className,
      )}
    >
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Centred spinner for a route or panel that is still loading. */
export function LoadingPanel({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="grid min-h-[40vh] place-items-center">
      <div className="flex flex-col items-center gap-3 text-content-muted">
        <Spinner size="lg" className="text-primary" />
        <p className="text-sm">{label}…</p>
      </div>
    </div>
  );
}
