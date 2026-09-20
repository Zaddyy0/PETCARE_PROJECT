import { z } from 'zod';

/**
 * Reusable Zod primitives.
 *
 * These schemas are the *single* validation layer: the API validates requests
 * with them and the web client validates forms with them. A rule written once
 * cannot drift, and the client can show the same message the server would have
 * returned — before the round trip.
 */

/** 24-character lowercase hex, i.e. a stringified Mongo ObjectId. */
export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Email is too short')
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

/**
 * Password policy.
 *
 * Length is weighted far more heavily than symbol classes — a 12-character
 * passphrase beats `P@ss1!` by orders of magnitude, and complexity rules mostly
 * teach people to append `1!`. We require a floor of 10 with at least three of
 * four character classes, which is defensible without being theatre.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Password is too long')
  .superRefine((value, ctx) => {
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;

    if (classes < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Mix upper case, lower case, numbers or symbols',
      });
    }

    if (/^(.)\1+$/.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That password is too simple' });
    }
  });

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'This field is required')
  .max(60, 'Keep this under 60 characters')
  /* Allows accents, apostrophes and hyphens — O'Brien and Núñez are names. */
  .regex(/^[\p{L}\p{M}'’\- .]+$/u, 'Use letters, spaces, hyphens and apostrophes only');

/** E.164. Deliberately permissive — phone formats vary enormously by country. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Enter a valid phone number, e.g. +919876543210');

export const urlSchema = z.string().trim().url('Enter a valid URL');

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Enter a valid date and time' });

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`)), 'That date is not real');

export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use 24-hour time, e.g. 09:30');

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    /* Ask the platform rather than shipping a stale IANA list. */
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown timezone');

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Use a 3-letter currency code');

/** Money always arrives in minor units, as a non-negative integer. */
export const amountMinorSchema = z
  .number()
  .int('Amount must be a whole number of minor units')
  .min(0, 'Amount cannot be negative')
  .max(100_000_000, 'Amount is too large');

export const addressSchema = z.object({
  line1: z.string().trim().min(1, 'Address is required').max(120),
  line2: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1, 'City is required').max(80),
  state: z.string().trim().min(1, 'State is required').max(80),
  postalCode: z.string().trim().min(3, 'Postal code is required').max(16),
  country: z.string().trim().min(2, 'Country is required').max(60),
});

/** Free-text that will be rendered back to users. Trimmed and length-capped. */
export const shortTextSchema = (max = 200) => z.string().trim().max(max);
export const longTextSchema = (max = 5000) => z.string().trim().max(max);

/**
 * Tag-style string arrays (allergies, specializations, languages).
 *
 * Normalised on the way in: trimmed, blanks dropped, duplicates removed. Doing
 * it here rather than in each service is why the same list cannot arrive clean
 * through one endpoint and ragged through another.
 */
export const tagListSchema = (max = 20, itemMax = 60) =>
  z
    .array(z.string().trim().min(1).max(itemMax))
    .max(max, `Add at most ${max} entries`)
    .transform((items) => Array.from(new Set(items.filter(Boolean))))
    .default([]);

/* -------------------------------------------------------------------------- */
/*                                 Pagination                                 */
/* -------------------------------------------------------------------------- */

/**
 * Query-string numbers arrive as strings, so we coerce.
 *
 * `limit` is capped at 100 on purpose. An uncapped `?limit=100000` is a free
 * denial-of-service against your own database, and it is the single most common
 * way a paginated endpoint stops being paginated.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(120).optional(),
});

export const cursorSchema = z.object({
  cursor: z.string().trim().max(200).nullish(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({ id: objectIdSchema });

/** Accepts `?status=a&status=b` and `?status=a` alike. */
export const arrayOrSingle = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, z.array(schema)]).transform((value) => (Array.isArray(value) ? value : [value]));

export const dateRangeSchema = z
  .object({
    from: isoDateTimeSchema.optional(),
    to: isoDateTimeSchema.optional(),
  })
  .refine(
    (value) => !value.from || !value.to || new Date(value.from) < new Date(value.to),
    { message: 'The start must come before the end', path: ['from'] },
  );
