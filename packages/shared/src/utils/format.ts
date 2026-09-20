/**
 * Presentation helpers shared by the API (for emails) and the web client.
 */

import type { Money } from '../types/common.js';

/** Render minor units as currency: `{ amountMinor: 149900, currency: 'INR' }` → `₹1,499.00`. */
export function formatMoney(money: Money, locale = 'en-IN'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
  }).format(money.amountMinor / 100);
}

/** Compact form for dashboard tiles: `12.4K`, `1.2M`. */
export function formatCompactNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatPercent(fraction: number, fractionDigits = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(fraction);
}

export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim().replace(/\s+/g, ' ');
}

/** Two-letter monogram for an avatar fallback. */
export function initials(firstName: string, lastName: string): string {
  const first = firstName.trim().charAt(0).toUpperCase();
  const last = lastName.trim().charAt(0).toUpperCase();
  return `${first}${last}` || '?';
}

/**
 * A pet's age, phrased the way an owner would say it.
 *
 * Under two years people count months — "14 months" is meaningful where
 * "1 year" throws away most of the information, and for a puppy that
 * difference is clinically relevant.
 */
export function petAgeLabel(dateOfBirth: string | null | undefined, now = new Date()): string {
  const months = petAgeInMonths(dateOfBirth, now);
  if (months === null) return 'Age unknown';
  if (months < 1) return 'Under a month';
  if (months < 24) return `${months} month${months === 1 ? '' : 's'}`;

  const years = Math.floor(months / 12);
  const remainder = months % 12;

  if (remainder === 0) return `${years} year${years === 1 ? '' : 's'}`;
  return `${years}y ${remainder}m`;
}

export function petAgeInMonths(
  dateOfBirth: string | null | undefined,
  now = new Date(),
): number | null {
  if (!dateOfBirth) return null;

  const born = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(born.getTime())) return null;

  let months =
    (now.getUTCFullYear() - born.getUTCFullYear()) * 12 + (now.getUTCMonth() - born.getUTCMonth());

  /* Do not count the current month until the day-of-month has come round. */
  if (now.getUTCDate() < born.getUTCDate()) {
    months -= 1;
  }

  return Math.max(0, months);
}

/** Truncate on a word boundary, with a real ellipsis. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

/** URL-safe slug. */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Mask an email for display in a confirmation message.
 *
 * `alice@example.com` → `a***e@example.com`. Enough for the user to recognise
 * their own address, not enough to hand an attacker a full one.
 */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (local.length <= 2) return `${local.charAt(0)}***@${domain}`;
  return `${local.charAt(0)}***${local.charAt(local.length - 1)}@${domain}`;
}

/** Pluralise with the count: `pluralize(1, 'pet')` → `1 pet`. */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
