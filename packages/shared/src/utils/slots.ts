/**
 * Slot generation.
 *
 * A doctor's calendar is stored as *rules* (a weekly pattern plus dated
 * overrides) and expanded into concrete slots on demand. This module is that
 * expansion, and it is deliberately **pure**: same inputs, same output, no
 * clock, no database, no I/O.
 *
 * Purity matters here for three reasons:
 *
 *   1. The API is authoritative — it re-runs this on every booking to confirm
 *      the requested start is a real slot, rather than trusting the client.
 *   2. The web client runs the identical function to paint the picker, so what
 *      a user sees and what the server accepts cannot disagree.
 *   3. Booking correctness becomes unit-testable without a database.
 */

import type { AvailabilityOverride, TimeBlock, WeeklyAvailability } from '../types/user.js';
import {
  dayOfWeekInZone,
  eachDateOnly,
  minutesToTime,
  timeToMinutes,
  zonedTimeToUtc,
} from './datetime.js';

export interface SlotGenerationOptions {
  /** Inclusive `YYYY-MM-DD` in the doctor's timezone. */
  from: string;
  /** Inclusive `YYYY-MM-DD` in the doctor's timezone. */
  to: string;
  timeZone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  weekly: WeeklyAvailability[];
  overrides: AvailabilityOverride[];
  /** Slot starts already taken, as epoch milliseconds. A Set — lookups are hot. */
  bookedStartsMs?: ReadonlySet<number>;
  /** Slots starting before this instant are dropped (minimum-notice rule). */
  notBefore?: Date;
  /** Slots starting at or after this instant are dropped (advance-booking rule). */
  notAfter?: Date;
}

export interface GeneratedSlot {
  start: Date;
  end: Date;
  isAvailable: boolean;
}

/**
 * Expand availability rules into the slot grid for a date range.
 *
 * Returns every grid position in the window, each flagged available or not,
 * rather than only the free ones — a picker that renders taken slots as
 * struck-through reads far better than one where they silently vanish.
 */
export function generateSlots(options: SlotGenerationOptions): GeneratedSlot[] {
  const {
    from,
    to,
    timeZone,
    slotDurationMinutes,
    bufferMinutes,
    weekly,
    overrides,
    bookedStartsMs = new Set<number>(),
    notBefore,
    notAfter,
  } = options;

  if (slotDurationMinutes <= 0) return [];

  /* Index the rules once rather than scanning them per day. */
  const weeklyByDay = new Map<number, TimeBlock[]>();
  for (const entry of weekly) {
    weeklyByDay.set(entry.dayOfWeek, entry.blocks);
  }

  const overrideByDate = new Map<string, AvailabilityOverride>();
  for (const override of overrides) {
    overrideByDate.set(override.date, override);
  }

  const stride = slotDurationMinutes + bufferMinutes;
  const slots: GeneratedSlot[] = [];

  for (const date of eachDateOnly(from, to)) {
    const override = overrideByDate.get(date);

    /* A dated override replaces the weekly pattern for that day outright —
       it never merges with it. Merging would make "closed for a public
       holiday" impossible to express. */
    let blocks: TimeBlock[];

    if (override) {
      if (override.isUnavailable) continue;
      blocks = override.blocks;
    } else {
      /* Which weekday is this date in the doctor's zone? Derived from noon
         local time, which is never ambiguous across a DST transition. */
      const noon = zonedTimeToUtc(date, '12:00', timeZone);
      const weekday = dayOfWeekInZone(noon, timeZone);
      blocks = weeklyByDay.get(weekday) ?? [];
    }

    for (const block of blocks) {
      const blockStart = timeToMinutes(block.start);
      const blockEnd = timeToMinutes(block.end);

      for (let minute = blockStart; minute + slotDurationMinutes <= blockEnd; minute += stride) {
        const start = zonedTimeToUtc(date, minutesToTime(minute), timeZone);
        const end = new Date(start.getTime() + slotDurationMinutes * 60_000);

        if (notBefore && start.getTime() < notBefore.getTime()) continue;
        if (notAfter && start.getTime() >= notAfter.getTime()) continue;

        slots.push({
          start,
          end,
          isAvailable: !bookedStartsMs.has(start.getTime()),
        });
      }
    }
  }

  /* An override can place a block earlier in the day than the weekly pattern,
     so the accumulated list is not guaranteed to be in order. */
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  return slots;
}

/**
 * Is `candidate` a legitimate position on this doctor's grid?
 *
 * The booking service calls this before writing. It is the reason a crafted
 * request for `09:07` — or for 3am on a day the doctor does not work — is
 * rejected rather than quietly stored. Note it deliberately ignores whether the
 * slot is *taken*: that race is settled by the database's unique index, not by
 * a check-then-write here, which two concurrent requests would both pass.
 */
export function isValidSlotStart(
  candidate: Date,
  options: Omit<SlotGenerationOptions, 'from' | 'to' | 'bookedStartsMs'>,
): boolean {
  const { timeZone } = options;

  /* Generate only the day either side of the candidate. Checking a single
     instant against a 60-day grid would be absurd. */
  const candidateDate = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(candidate);

  const slots = generateSlots({
    ...options,
    from: candidateDate,
    to: candidateDate,
  });

  const target = candidate.getTime();
  return slots.some((slot) => slot.start.getTime() === target);
}

/**
 * Snap an arbitrary instant down to the nearest grid position on its day.
 *
 * Used when staff book by dragging on a calendar and land between positions.
 * Returns `null` when the instant falls outside every working block, rather
 * than inventing a nearby slot the doctor never offered.
 */
export function snapToSlot(
  candidate: Date,
  options: Omit<SlotGenerationOptions, 'from' | 'to' | 'bookedStartsMs'>,
): Date | null {
  const candidateDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: options.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(candidate);

  const slots = generateSlots({ ...options, from: candidateDate, to: candidateDate });
  const target = candidate.getTime();

  let best: Date | null = null;
  for (const slot of slots) {
    if (slot.start.getTime() <= target) {
      best = slot.start;
    } else {
      break;
    }
  }

  return best;
}

/** Group a flat slot list into day buckets for rendering. */
export function groupSlotsByDate(
  slots: GeneratedSlot[],
  timeZone: string,
): { date: string; slots: GeneratedSlot[] }[] {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const buckets = new Map<string, GeneratedSlot[]>();

  for (const slot of slots) {
    const key = formatter.format(slot.start);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(slot);
    } else {
      buckets.set(key, [slot]);
    }
  }

  return [...buckets.entries()]
    .map(([date, daySlots]) => ({ date, slots: daySlots }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** The share of offered slots that are taken, as a 0–1 fraction. */
export function utilizationRate(slots: GeneratedSlot[]): number {
  if (slots.length === 0) return 0;
  const taken = slots.filter((slot) => !slot.isAvailable).length;
  return taken / slots.length;
}
