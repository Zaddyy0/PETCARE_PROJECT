/**
 * Timezone-correct date arithmetic, with no runtime dependency.
 *
 * Booking spans timezones and daylight-saving transitions, and getting this
 * wrong is not a cosmetic bug — it silently books people an hour off twice a
 * year. Rather than pull in a date library we lean on `Intl`, which ships with
 * the current IANA database in both Node and every target browser.
 */

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

/**
 * The offset, in milliseconds, that `timeZone` was at the given instant.
 *
 * Works by asking `Intl` what wall-clock time the zone showed at that instant,
 * re-reading those fields as if they were UTC, and taking the difference.
 * Positive east of Greenwich: `+19800000` for Asia/Kolkata.
 */
export function timeZoneOffsetMs(instantMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = formatter.formatToParts(new Date(instantMs));
  const field: Record<string, number> = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      field[part.type] = Number(part.value);
    }
  }

  const wallClockAsUtc = Date.UTC(
    field['year'] ?? 1970,
    (field['month'] ?? 1) - 1,
    field['day'] ?? 1,
    /* `hour12: false` renders midnight as 24 in some ICU versions. */
    (field['hour'] ?? 0) % 24,
    field['minute'] ?? 0,
    field['second'] ?? 0,
  );

  return wallClockAsUtc - instantMs;
}

/**
 * Convert a wall-clock time in a zone to the UTC instant it names.
 *
 * `zonedTimeToUtc('2026-10-01', '09:00', 'Asia/Kolkata')` → `03:30Z`.
 *
 * The offset depends on the instant, and the instant is what we are solving
 * for, so we iterate: guess, measure the offset there, correct, then re-measure
 * once. The second pass is what makes the hour either side of a DST jump come
 * out right — a single-pass conversion is off by an hour twice a year.
 */
export function zonedTimeToUtc(dateOnly: string, timeOfDay: string, timeZone: string): Date {
  const naive = Date.parse(`${dateOnly}T${timeOfDay}:00.000Z`);

  if (Number.isNaN(naive)) {
    throw new RangeError(`Invalid date/time: ${dateOnly}T${timeOfDay}`);
  }

  const firstOffset = timeZoneOffsetMs(naive, timeZone);
  let instant = naive - firstOffset;

  const secondOffset = timeZoneOffsetMs(instant, timeZone);
  if (secondOffset !== firstOffset) {
    instant = naive - secondOffset;
  }

  return new Date(instant);
}

/** The `YYYY-MM-DD` that the given instant falls on, in the given zone. */
export function formatDateOnly(instant: Date | number, timeZone = 'UTC'): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  /* `en-CA` renders as YYYY-MM-DD, which is exactly the shape we want. */
  return formatter.format(instant instanceof Date ? instant : new Date(instant));
}

/** The `HH:mm` wall-clock time at the given instant, in the given zone. */
export function formatTimeOnly(instant: Date | number, timeZone = 'UTC'): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(instant instanceof Date ? instant : new Date(instant));
}

/** Day of week `0`–`6` (Sunday first) for an instant, in the given zone. */
export function dayOfWeekInZone(instant: Date | number, timeZone: string): number {
  const ms = instant instanceof Date ? instant.getTime() : instant;
  const shifted = new Date(ms + timeZoneOffsetMs(ms, timeZone));
  return shifted.getUTCDay();
}

/** `'09:30'` → `570`. */
export function timeToMinutes(timeOfDay: string): number {
  const [hours = '0', minutes = '0'] = timeOfDay.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** `570` → `'09:30'`. */
export function minutesToTime(totalMinutes: number): string {
  const normalised = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalised / 60);
  const minutes = normalised % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Walk forward by whole calendar days on a `YYYY-MM-DD` string. */
export function addDaysToDateOnly(dateOnly: string, days: number): string {
  const base = Date.parse(`${dateOnly}T00:00:00.000Z`);
  return formatDateOnly(new Date(base + days * MS_PER_DAY), 'UTC');
}

/** Inclusive list of `YYYY-MM-DD` strings from `from` to `to`. */
export function eachDateOnly(from: string, to: string): string[] {
  const dates: string[] = [];
  const end = Date.parse(`${to}T00:00:00.000Z`);
  let cursor = Date.parse(`${from}T00:00:00.000Z`);

  /* Guard against a reversed range producing an unbounded loop. */
  while (cursor <= end && dates.length < 400) {
    dates.push(formatDateOnly(new Date(cursor), 'UTC'));
    cursor += MS_PER_DAY;
  }

  return dates;
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * MS_PER_MINUTE);
}

export function differenceInMinutes(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / MS_PER_MINUTE);
}

export function differenceInHours(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_HOUR;
}

export function differenceInDays(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}

export function isPast(instant: Date | string, now: Date = new Date()): boolean {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  return ms < now.getTime();
}

/** Relative phrasing for feeds: "in 3 hours", "2 days ago", "just now". */
export function formatRelative(instant: Date | string, now: Date = new Date()): string {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant.getTime();
  const deltaSeconds = Math.round((ms - now.getTime()) / 1000);
  const absolute = Math.abs(deltaSeconds);

  if (absolute < 45) return 'just now';

  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  for (const [unit, seconds] of units) {
    if (absolute >= seconds) {
      return formatter.format(Math.round(deltaSeconds / seconds), unit);
    }
  }

  return formatter.format(deltaSeconds, 'second');
}
