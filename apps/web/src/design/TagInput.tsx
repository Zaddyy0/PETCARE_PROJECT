import { AnimatePresence, motion } from 'framer-motion';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

/**
 * A tag list built from a text input.
 *
 * Used for allergies, conditions, specialisations — lists with no fixed
 * vocabulary, where a `<select>` would be wrong and a comma-separated text
 * field pushes the parsing problem onto the user.
 *
 * The keyboard handling is what makes this usable:
 *
 *   • **Enter** commits the draft. `preventDefault` is essential — inside a
 *     form, Enter would otherwise submit it, so typing one allergy would save
 *     the whole record.
 *   • **Comma** also commits, because people type lists with commas whatever
 *     the affordance says.
 *   • **Backspace on an empty input** removes the last tag, which is what
 *     every tag field people have used already does.
 */
export function TagInput({
  label,
  value,
  onChange,
  placeholder = 'Add and press Enter',
  hint,
  error,
  maxTags = 20,
  maxLength = 60,
}: {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  maxTags?: number;
  maxLength?: number;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();

  function commit(raw: string) {
    const tag = raw.trim();
    if (!tag) return;

    /* Case-insensitive de-duplication: "Chicken" and "chicken" are the same
       allergy, and storing both makes the list look careless. */
    const exists = value.some((existing) => existing.toLowerCase() === tag.toLowerCase());

    if (!exists && value.length < maxTags) {
      onChange([...value, tag.slice(0, maxLength)]);
    }

    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      /* Without this, Enter submits the enclosing form. */
      event.preventDefault();
      commit(draft);
      return;
    }

    if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  const full = value.length >= maxTags;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-content">
        {label}
        {value.length > 0 && (
          <span className="ml-1.5 text-xs font-normal text-content-subtle">
            {value.length}
            {full && ` / ${maxTags}`}
          </span>
        )}
      </label>

      {/* The whole box is click-to-focus, so the generous target includes the
          padding around the tags rather than just the input line. */}
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border bg-surface px-2 py-1.5',
          'transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25',
          error ? 'border-danger' : 'border-border hover:border-border-strong',
        )}
      >
        <AnimatePresence initial={false}>
          {value.map((tag) => (
            <motion.span
              key={tag}
              layout
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={spring}
              className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2 py-1 text-xs font-medium text-primary"
            >
              {tag}
              <button
                type="button"
                onClick={(event) => {
                  /* The wrapper focuses the input on click; this must not. */
                  event.stopPropagation();
                  onChange(value.filter((existing) => existing !== tag));
                }}
                aria-label={`Remove ${tag}`}
                className="grid size-3.5 place-items-center rounded-full transition-colors hover:bg-primary/20"
              >
                <svg aria-hidden viewBox="0 0 8 8" className="size-2" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" strokeLinecap="round" />
                </svg>
              </button>
            </motion.span>
          ))}
        </AnimatePresence>

        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          value={draft}
          maxLength={maxLength}
          disabled={full}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          /**
           * Commit on blur too.
           *
           * A user who types an allergy and then clicks "Save" without pressing
           * Enter expects it to be there. Discarding the draft silently loses
           * data the user believed they had entered.
           */
          onBlur={() => commit(draft)}
          placeholder={value.length === 0 ? placeholder : full ? '' : 'Add another…'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className="min-w-[8rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-content placeholder:text-content-subtle focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      {hint && !error && (
        <p id={`${fieldId}-hint`} className="text-xs text-content-subtle text-pretty">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
