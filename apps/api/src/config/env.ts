/**
 * Environment configuration — validated once, at boot, or the process does not
 * start.
 *
 * The rule here is **fail fast and fail loudly**. A misconfigured server that
 * starts successfully and then misbehaves at 3am is far worse than one that
 * refuses to boot with a precise message. Every value the application needs is
 * declared below, so `process.env` is read in exactly one file and the rest of
 * the codebase consumes a typed, guaranteed-present object.
 *
 * This replaces the previous `getJwtSecret()` helper, which fell back to a
 * hardcoded string when `JWT_SECRET` was unset. That fallback was a complete
 * authentication bypass: anyone who read the source could forge a token for any
 * account on any deployment that forgot the variable. There is now no fallback
 * in production at all.
 */

import { config as loadDotenv } from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Find `.env` by walking up from the current directory.
 *
 * `dotenv` only looks in `process.cwd()`, and in a monorepo the cwd depends on
 * how you were invoked: `npm run dev` from the root leaves it at the root,
 * while `npm run seed --workspace @pawsitive/api` moves it to `apps/api`. The
 * same command then works or fails depending on which directory you happened to
 * be standing in — with a "MONGODB_URI is required" error that points at the
 * wrong problem entirely.
 *
 * One `.env` at the repo root, found from anywhere. An app-local `.env` still
 * wins if one exists, since the nearer file is loaded first and `dotenv` does
 * not overwrite variables that are already set.
 */
function loadEnvFiles(): void {
  let directory = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = path.join(directory, '.env');

    if (fs.existsSync(candidate)) {
      loadDotenv({ path: candidate });
    }

    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

loadEnvFiles();

const isProduction = process.env['NODE_ENV'] === 'production';

/**
 * Secrets must be long enough to resist offline brute force.
 *
 * In production they are mandatory. In development and test we generate a
 * random one per process so a fresh clone runs without ceremony — but because
 * it is random, it dies with the process (restarting invalidates tokens, which
 * is a correct and visible consequence) and it can never accidentally ship.
 */
const secretSchema = (name: string) =>
  isProduction
    ? z
        .string({ required_error: `${name} is required in production` })
        .min(32, `${name} must be at least 32 characters`)
    : z
        .string()
        .min(32)
        .optional()
        .transform((value) => value ?? crypto.randomBytes(48).toString('base64url'));

const booleanFromString = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === 'true' || value === '1'));

const envSchema = z.object({
  /* ---------------------------------------------------------------- runtime */
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(5000),
  API_PREFIX: z.string().default('/api/v1'),
  /** Comma-separated list of origins allowed to call the API with credentials. */
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  /** Public base URL of the web client, used to build links in emails. */
  WEB_APP_URL: z.string().url().default('http://localhost:5173'),
  /**
   * How many reverse proxies sit in front of this process.
   *
   * A number, never `true`. `trust proxy: true` tells Express to believe the
   * entire `X-Forwarded-For` chain, which lets a caller spoof their IP and walk
   * straight through per-IP rate limiting. Render and Railway put exactly one
   * proxy in front, so `1` is correct there.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

  /* --------------------------------------------------------------- database */
  MONGODB_URI: z
    .string({ required_error: 'MONGODB_URI is required' })
    .min(1)
    .refine(
      (value) => value.startsWith('mongodb://') || value.startsWith('mongodb+srv://'),
      'MONGODB_URI must be a mongodb:// or mongodb+srv:// connection string',
    ),
  MONGODB_DB_NAME: z.string().default('pawsitive'),
  /**
   * Connection pool ceiling.
   *
   * Atlas' shared tiers cap total connections quite low, and each running
   * instance claims up to this many. 10 per instance is a sane default that
   * leaves headroom to scale horizontally without exhausting the cluster.
   */
  MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(500).default(10),
  MONGODB_MIN_POOL_SIZE: z.coerce.number().int().min(0).max(100).default(0),

  /* ------------------------------------------------------------------ auth */
  JWT_ACCESS_SECRET: secretSchema('JWT_ACCESS_SECRET'),
  /**
   * A *separate* secret for refresh tokens.
   *
   * Sharing one secret means a leaked access token signature could be replayed
   * as a refresh token. Separate keys keep the blast radius of either leak
   * contained to that token class.
   */
  JWT_REFRESH_SECRET: secretSchema('JWT_REFRESH_SECRET'),
  JWT_ISSUER: z.string().default('pawsitive.api'),
  JWT_AUDIENCE: z.string().default('pawsitive.web'),
  /** Hashes password-reset and invite tokens at rest. */
  TOKEN_PEPPER: secretSchema('TOKEN_PEPPER'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: booleanFromString(isProduction),

  /* ------------------------------------------------------------- cloudinary */
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER: z.string().default('pawsitive'),

  /* ------------------------------------------------------------------ mail */
  MAIL_ENABLED: booleanFromString(false),
  MAIL_HOST: z.string().optional(),
  MAIL_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
  MAIL_SECURE: booleanFromString(false),
  MAIL_USER: z.string().optional(),
  MAIL_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Pawsitive <no-reply@pawsitive.app>'),

  /* --------------------------------------------------------------- features */
  ENABLE_REALTIME: booleanFromString(true),
  ENABLE_SCHEDULED_JOBS: booleanFromString(true),
  ENABLE_REQUEST_LOGGING: booleanFromString(true),
  ENABLE_SWAGGER: booleanFromString(!isProduction),

  /* ---------------------------------------------------------------- logging */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: booleanFromString(!isProduction),

  /* ------------------------------------------------------------ bootstrapping */
  /** When set, a super admin with these credentials is created if none exists. */
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_PASSWORD: z.string().min(10).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parse and validate, or exit.
 *
 * We print every problem at once rather than one per restart — nothing is more
 * tedious than fixing five variables through five reboots.
 */
/**
 * Drop blank values before validating.
 *
 * A `.env` file written as `SUPER_ADMIN_EMAIL=` gives dotenv an empty *string*,
 * not `undefined` — so `.optional()` does not apply and the value is validated
 * as though it were supplied, failing on `.email()` or `.min(32)`. Treating
 * blank as absent is what makes a commented-out-by-emptying line behave the way
 * everyone expects.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') {
      result[key] = value;
    }
  }

  return result;
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(withoutBlanks(process.env));

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    /* This runs before the logger exists, so `console` is correct here. */
    console.error(
      `\n\x1b[31m✖ Invalid environment configuration\x1b[0m\n\n${issues}\n\n` +
        `Copy .env.example to .env and fill in the missing values.\n`,
    );
    process.exit(1);
  }

  const env = parsed.data;

  /* Cross-field checks that a per-field schema cannot express. ------------- */
  const warnings: string[] = [];

  if (env.MAIL_ENABLED && (!env.MAIL_HOST || !env.MAIL_USER || !env.MAIL_PASSWORD)) {
    console.error(
      '\n\x1b[31m✖ MAIL_ENABLED is true but MAIL_HOST, MAIL_USER or MAIL_PASSWORD is missing.\x1b[0m\n',
    );
    process.exit(1);
  }

  const cloudinaryKeys = [
    env.CLOUDINARY_CLOUD_NAME,
    env.CLOUDINARY_API_KEY,
    env.CLOUDINARY_API_SECRET,
  ];
  const cloudinaryConfigured = cloudinaryKeys.every(Boolean);

  if (!cloudinaryConfigured && cloudinaryKeys.some(Boolean)) {
    console.error(
      '\n\x1b[31m✖ Cloudinary is partially configured. Set all three of ' +
        'CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET, or none.\x1b[0m\n',
    );
    process.exit(1);
  }

  if (env.NODE_ENV === 'production') {
    if (!cloudinaryConfigured) {
      warnings.push('Cloudinary is not configured — image uploads will be rejected.');
    }
    if (!env.MAIL_ENABLED) {
      warnings.push('Mail is disabled — password resets and invitations cannot be delivered.');
    }
    if (env.TRUST_PROXY_HOPS === 0) {
      warnings.push(
        'TRUST_PROXY_HOPS is 0. Behind a load balancer, rate limiting will see the proxy IP ' +
          'for every request and throttle all users as one.',
      );
    }
    if (env.CORS_ORIGINS.some((origin) => origin.includes('localhost'))) {
      warnings.push('CORS_ORIGINS still contains localhost in production.');
    }
  } else if (!process.env['JWT_ACCESS_SECRET']) {
    warnings.push(
      'JWT secrets were generated for this process. Sessions will not survive a restart. ' +
        'Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in .env to keep them.',
    );
  }

  for (const warning of warnings) {
    console.warn(`\x1b[33m⚠ ${warning}\x1b[0m`);
  }

  return env;
}

export const env = loadEnv();

export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
export const isProd = env.NODE_ENV === 'production';

/** True only when all three Cloudinary credentials are present. */
export const isCloudinaryConfigured = Boolean(
  env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET,
);
