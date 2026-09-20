import { useEffect, useState } from 'react';
import { useDebounced } from '@/app/hooks';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

/**
 * A debounced search box.
 *
 * Keeps its own immediate state for the input so typing stays responsive, and
 * reports upward only once typing pauses. Without the debounce a ten-character
 * query fires ten requests whose responses can arrive out of order, leaving the
 * list showing results for a *prefix* of what was typed.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  loading = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  loading?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebounced(draft, 300);

  useEffect(() => {
    /* Guarded, or this fires on mount and on every parent re-render. */
    if (debounced !== value) onChange(debounced);
  }, [debounced, value, onChange]);

  /* Keep in sync when the parent resets the query — clearing a filter set. */
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className={cn('relative', className)}>
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle"
      >
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" strokeLinecap="round" />
        </svg>
      </span>

      <input
        type="search"
        role="searchbox"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-9 text-sm text-content placeholder:text-content-subtle transition-[border-color,box-shadow] hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />

      {/* The spinner sits where the clear button would, so nothing shifts. */}
      {loading && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-content-subtle">
          <Spinner size="sm" />
        </span>
      )}

      {!loading && draft && (
        <button
          type="button"
          onClick={() => setDraft('')}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded text-content-subtle transition-colors hover:bg-surface-hover hover:text-content"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

/**
 * A row of filter chips.
 *
 * A radio group rather than a set of buttons: only one can be active, and
 * `role="radiogroup"` is what tells a screen reader that — a row of buttons
 * announces as seven independent controls with no indication they are
 * alternatives.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('flex gap-1.5 overflow-x-auto no-scrollbar', className)}
    >
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border text-content-muted hover:border-border-strong hover:text-content',
            )}
          >
            {option.label}
            {option.count !== undefined && (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[0.625rem] tabular-nums',
                  active ? 'bg-primary/15' : 'bg-surface-sunken',
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Wraps a search box and filters, stacking on narrow screens. */
export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('mb-5 flex flex-col gap-3 sm:flex-row sm:items-center', className)}>
      {children}
    </div>
  );
}
