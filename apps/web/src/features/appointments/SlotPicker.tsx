import { AnimatePresence, motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { AvailableSlot } from '@pawsitive/shared';
import { cn } from '@/lib/cn';
import { spring, staggerContainer, staggerItem } from '@/lib/motion';
import { Skeleton } from '@/design/Skeleton';
import { EmptyState } from '@/design/EmptyState';

/**
 * The slot picker.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  WHY TAKEN SLOTS ARE SHOWN, NOT HIDDEN
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The API returns every position on the doctor's grid with an `isAvailable`
 * flag, and this renders all of them — taken ones struck through and
 * unclickable.
 *
 * Hiding them would be easier and much worse. A Tuesday showing "10:00, 14:30"
 * is indistinguishable from a doctor who works two hours a week; the same
 * Tuesday showing twelve slots with ten crossed out reads immediately as "busy
 * day, two openings left". The user learns something true either way, and the
 * second one also creates urgency honestly.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  TIMEZONES
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Slot instants arrive as UTC ISO strings. They are grouped and labelled in the
 * **doctor's** timezone, not the viewer's, because "Tuesday 9am" has to mean
 * the clinic's Tuesday 9am. A client in another timezone sees the clinic's
 * local time with their own offset noted, which is the only framing that is not
 * misleading.
 */

export interface SlotPickerProps {
  slots: AvailableSlot[];
  /** The doctor's IANA timezone, as returned alongside the slots. */
  timezone: string;
  value: string | null;
  onChange: (slotStart: string) => void;
  loading?: boolean;
}

interface DayGroup {
  /** `YYYY-MM-DD` in the doctor's timezone. */
  key: string;
  label: string;
  weekday: string;
  dayNumber: string;
  slots: AvailableSlot[];
  availableCount: number;
}

export function SlotPicker({ slots, timezone, value, onChange, loading }: SlotPickerProps) {
  const days = useMemo(() => groupByDay(slots, timezone), [slots, timezone]);

  /* Default to the first day that actually has something bookable — opening on
     a fully-booked day makes the picker look broken. */
  const firstOpen = days.find((day) => day.availableCount > 0)?.key ?? days[0]?.key ?? null;
  const [activeDay, setActiveDay] = useState<string | null>(null);

  const selectedDay = activeDay ?? firstOpen;
  const day = days.find((entry) => entry.key === selectedDay) ?? days[0];

  const viewerOffsetDiffers = useMemo(() => offsetDiffers(timezone), [timezone]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-[4.5rem] w-16 shrink-0 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 12 }, (_, index) => (
            <Skeleton key={index} className="h-10 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (days.length === 0) {
    return (
      <EmptyState
        illustration="📭"
        title="No availability in this period"
        description="This vet has no open hours in the next few weeks. Try another clinician, or check back later."
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Day strip -------------------------------------------------- */}
      <div
        role="tablist"
        aria-label="Choose a day"
        className="flex gap-2 overflow-x-auto pb-1 no-scrollbar"
      >
        {days.map((entry) => {
          const active = entry.key === day?.key;
          const soldOut = entry.availableCount === 0;

          return (
            <button
              key={entry.key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setActiveDay(entry.key)}
              className={cn(
                'relative flex shrink-0 flex-col items-center gap-0.5 rounded-xl border px-3 py-2 transition-colors',
                active
                  ? 'border-primary bg-primary-soft'
                  : 'border-border hover:border-border-strong hover:bg-surface-hover',
                /* Dimmed, not hidden — a fully-booked day is information. */
                soldOut && !active && 'opacity-55',
              )}
            >
              <span
                className={cn(
                  'text-[0.625rem] font-medium uppercase tracking-wide',
                  active ? 'text-primary' : 'text-content-subtle',
                )}
              >
                {entry.weekday}
              </span>
              <span
                className={cn(
                  'text-lg font-semibold tabular-nums leading-none',
                  active ? 'text-primary' : 'text-content',
                )}
              >
                {entry.dayNumber}
              </span>
              <span
                className={cn(
                  'text-[0.625rem] tabular-nums',
                  soldOut ? 'text-content-subtle' : active ? 'text-primary' : 'text-content-muted',
                )}
              >
                {soldOut ? 'Full' : `${entry.availableCount} free`}
              </span>

              {active && (
                <motion.span
                  layoutId="slot-day-indicator"
                  transition={spring}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* ---- Timezone note ---------------------------------------------- */}
      {viewerOffsetDiffers && (
        <p className="flex items-start gap-1.5 rounded-lg bg-info-soft px-3 py-2 text-xs text-info">
          <span aria-hidden>🌍</span>
          Times are shown in the clinic&rsquo;s timezone ({shortZone(timezone)}), which is
          different from yours.
        </p>
      )}

      {/* ---- Slot grid --------------------------------------------------- */}
      <AnimatePresence mode="wait">
        <motion.div
          key={day?.key ?? 'none'}
          variants={staggerContainer(0.012)}
          initial="hidden"
          animate="visible"
          exit={{ opacity: 0 }}
        >
          {day && day.slots.length > 0 ? (
            <>
              <p className="mb-2 text-sm font-medium text-content">{day.label}</p>

              <div
                role="radiogroup"
                aria-label={`Available times on ${day.label}`}
                className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
              >
                {day.slots.map((slot) => {
                  const selected = slot.start === value;
                  const time = formatTime(slot.start, timezone);

                  return (
                    <motion.button
                      key={slot.start}
                      variants={staggerItem}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={!slot.isAvailable}
                      onClick={() => onChange(slot.start)}
                      whileHover={slot.isAvailable ? { scale: 1.03 } : undefined}
                      whileTap={slot.isAvailable ? { scale: 0.97 } : undefined}
                      transition={spring}
                      className={cn(
                        'h-10 rounded-lg border text-sm font-medium tabular-nums transition-colors',
                        selected && 'border-primary bg-primary text-primary-fg shadow-sm',
                        !selected &&
                          slot.isAvailable &&
                          'border-border text-content hover:border-primary hover:bg-primary-soft',
                        !slot.isAvailable &&
                          'cursor-not-allowed border-transparent bg-surface-sunken text-content-subtle line-through',
                      )}
                    >
                      {time}
                      {/* The strikethrough is visual only. */}
                      {!slot.isAvailable && <span className="sr-only"> — already booked</span>}
                    </motion.button>
                  );
                })}
              </div>

              {day.availableCount === 0 && (
                <p className="mt-3 text-sm text-content-muted">
                  Every slot on {day.weekday} is taken. Try another day above.
                </p>
              )}
            </>
          ) : (
            <EmptyState compact illustration="🌙" title="No hours on this day" />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

/**
 * Group slots into days **in the doctor's timezone**.
 *
 * Grouping by the viewer's local date would split a clinic's single working day
 * across two cards for anyone more than a few hours offset — an evening slot in
 * Hyderabad is the following morning in Los Angeles.
 */
function groupByDay(slots: AvailableSlot[], timezone: string): DayGroup[] {
  const dayFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const labelFormatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  const weekdayFormatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    weekday: 'short',
  });

  const dayNumberFormatter = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    day: 'numeric',
  });

  const buckets = new Map<string, AvailableSlot[]>();

  for (const slot of slots) {
    const date = new Date(slot.start);
    const key = dayFormatter.format(date);

    const bucket = buckets.get(key);
    if (bucket) bucket.push(slot);
    else buckets.set(key, [slot]);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, daySlots]) => {
      const first = new Date(daySlots[0]!.start);

      return {
        key,
        label: labelFormatter.format(first),
        weekday: weekdayFormatter.format(first),
        dayNumber: dayNumberFormatter.format(first),
        slots: daySlots,
        availableCount: daySlots.filter((slot) => slot.isAvailable).length,
      };
    });
}

function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** Does the viewer's offset differ from the clinic's right now? */
function offsetDiffers(timezone: string): boolean {
  try {
    const now = new Date();
    const clinic = new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value;

    const viewer = new Intl.DateTimeFormat('en', { timeZoneName: 'shortOffset' })
      .formatToParts(now)
      .find((part) => part.type === 'timeZoneName')?.value;

    return Boolean(clinic && viewer && clinic !== viewer);
  } catch {
    /* An unknown zone should not break the picker. */
    return false;
  }
}

function shortZone(timezone: string): string {
  try {
    return (
      new Intl.DateTimeFormat('en', { timeZone: timezone, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? timezone
    );
  } catch {
    return timezone;
  }
}
