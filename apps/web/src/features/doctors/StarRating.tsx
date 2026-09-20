import { MAX_RATING } from '@pawsitive/shared';
import { cn } from '@/lib/cn';

/**
 * A star rating display.
 *
 * Renders partial stars with a clipped overlay rather than rounding to the
 * nearest whole or half star. A 4.2 shown as 4 stars is a lie the user can
 * catch by reading the number next to it, and rounding up is worse.
 *
 * The accessible name carries the actual value — a row of star glyphs announces
 * as nothing useful.
 */
export function StarRating({
  value,
  count,
  size = 'md',
  showValue = true,
}: {
  value: number;
  count?: number;
  size?: 'sm' | 'md' | 'lg';
  showValue?: boolean;
}) {
  const dimensions = {
    sm: 'size-3',
    md: 'size-4',
    lg: 'size-5',
  } as const;

  const text = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  } as const;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        role="img"
        aria-label={`${value.toFixed(1)} out of ${MAX_RATING} stars${count ? `, ${count} review${count === 1 ? '' : 's'}` : ''}`}
        className="inline-flex items-center gap-0.5"
      >
        {Array.from({ length: MAX_RATING }, (_, index) => {
          /* How much of *this* star is filled: 1, 0, or a fraction. */
          const fill = Math.max(0, Math.min(1, value - index));

          return (
            <span key={index} className={cn('relative inline-block', dimensions[size])}>
              {/* The empty star underneath. */}
              <Star className="absolute inset-0 text-border-strong" />

              {/* The filled portion, clipped horizontally. `overflow-hidden`
                  on a width-constrained wrapper is what gives a partial star
                  without needing an SVG gradient per value. */}
              {fill > 0 && (
                <span
                  aria-hidden
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                >
                  <Star className={cn('text-warning', dimensions[size])} />
                </span>
              )}
            </span>
          );
        })}
      </span>

      {showValue && (
        <span className={cn('font-medium tabular-nums text-content', text[size])}>
          {value.toFixed(1)}
        </span>
      )}

      {count !== undefined && (
        <span className={cn('tabular-nums text-content-subtle', text[size])}>
          ({count})
        </span>
      )}
    </span>
  );
}

function Star({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn('fill-current', className)}>
      <path d="M10 1.5l2.47 5.13 5.63.78-4.1 4 .96 5.6L10 14.35l-4.96 2.66.96-5.6-4.1-4 5.63-.78L10 1.5Z" />
    </svg>
  );
}

/**
 * An interactive star input.
 *
 * A radio group, so arrow keys work and the choice is announced as one of five
 * alternatives rather than five independent buttons.
 */
export function StarInput({
  value,
  onChange,
  label,
  error,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  error?: string;
}) {
  const labels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-content">{label}</span>

      <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
        {Array.from({ length: MAX_RATING }, (_, index) => {
          const star = index + 1;
          const active = star <= value;

          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={star === value}
              aria-label={`${star} star${star === 1 ? '' : 's'} — ${labels[index]}`}
              onClick={() => onChange(star)}
              className="rounded p-0.5 transition-transform hover:scale-110"
            >
              <Star className={cn('size-7', active ? 'text-warning' : 'text-border-strong')} />
            </button>
          );
        })}

        {value > 0 && (
          <span className="ml-2 text-sm font-medium text-content-muted">
            {labels[value - 1]}
          </span>
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
