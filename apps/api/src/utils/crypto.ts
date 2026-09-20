/**
 * Password hashing and token generation.
 *
 * **Why scrypt and not bcrypt.**
 *
 * The previous code used `bcryptjs` — a pure-JavaScript bcrypt — at a work
 * factor of 10. Pure-JS bcrypt is slow in the wrong way: it burns that time on
 * the main thread, so every sign-in blocks the event loop for the duration and
 * no other request is served meanwhile. At a work factor high enough to be
 * worth having (12+), that is several hundred milliseconds of total stall per
 * login. With a thousand users that is a self-inflicted outage at 9am.
 *
 * `crypto.scrypt` is in Node core, so there is no native module to compile on
 * Windows and no build toolchain needed on the deploy host. Critically, its
 * async form runs on libuv's thread pool: the hash is just as expensive for an
 * attacker, but it does not block anyone else's request. scrypt is also
 * memory-hard, which blunts the GPU and ASIC advantage that makes bcrypt
 * cracking cheap at scale.
 *
 * The encoded hash carries its own parameters, so the cost can be raised later
 * without invalidating existing passwords — old hashes keep verifying against
 * the parameters they were created with, and `needsRehash` reports which ones
 * should be upgraded on next successful sign-in.
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env.js';

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Tuned for roughly 100ms on a modern server core.
 *
 * `N` is the CPU/memory cost, `r` the block size, `p` parallelism. N=2^15 with
 * r=8 needs about 32MB per hash, which is the property that makes parallel
 * cracking expensive. `maxmem` must be raised above Node's 32MB default or the
 * call throws.
 */
const SCRYPT_PARAMS = {
  N: 32_768,
  r: 8,
  p: 1,
  keylen: 64,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024,
} as const;

const HASH_PREFIX = 'scrypt';

/**
 * Hash a password into a self-describing string:
 *
 *   `scrypt$32768$8$1$<salt-b64>$<hash-b64>`
 *
 * Storing the parameters alongside the digest is what makes a future cost
 * increase a non-event rather than a forced password reset for everyone.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SCRYPT_PARAMS.saltBytes);

  const derived = await scrypt(normalize(password), salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });

  return [
    HASH_PREFIX,
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns `false` rather than throwing on a malformed stored value: a corrupt
 * row should fail the login, not 500 the endpoint and reveal that the record
 * exists but is broken.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  try {
    const derived = await scrypt(normalize(password), parsed.salt, parsed.hash.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: SCRYPT_PARAMS.maxmem,
    });

    /* Constant-time: a byte-by-byte `===` leaks how much of the hash matched
       through timing, which is enough to reconstruct it given enough attempts. */
    return crypto.timingSafeEqual(derived, parsed.hash);
  } catch {
    return false;
  }
}

/** True when a stored hash was made with weaker parameters than we now use. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  hash: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return null;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  /* Refuse absurd parameters from a tampered row — they would let a crafted
     value turn one login into a memory-exhaustion denial of service. */
  if (N > 1_048_576 || r > 32 || p > 16) return null;
  if (!rawSalt || !rawHash) return null;

  return {
    N,
    r,
    p,
    salt: Buffer.from(rawSalt, 'base64'),
    hash: Buffer.from(rawHash, 'base64'),
  };
}

/**
 * Unicode-normalise before hashing.
 *
 * The same accented character can be encoded two ways (composed and
 * decomposed). Without normalisation, a password typed on macOS may not verify
 * against the same password typed on Windows.
 */
function normalize(password: string): string {
  return password.normalize('NFKC');
}

/* -------------------------------------------------------------------------- */
/*                                   Tokens                                   */
/* -------------------------------------------------------------------------- */

/**
 * A cryptographically random, URL-safe token for reset and invite links.
 *
 * 32 bytes is 256 bits of entropy — not guessable, and short enough to sit in a
 * URL without wrapping in an email client.
 */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Hash a token for storage.
 *
 * Reset and invite tokens are stored hashed for the same reason passwords are:
 * a leaked database dump should not hand the attacker a working password-reset
 * link for every pending request. The pepper is an application secret, so the
 * dump alone is not enough even to brute-force these.
 *
 * SHA-256 rather than scrypt is correct here: these tokens are already 256 bits
 * of uniform randomness, so there is nothing to brute-force and no need for a
 * slow KDF — which would only add latency to every verification.
 */
export function hashToken(token: string): string {
  return crypto.createHmac('sha256', env.TOKEN_PEPPER).update(token).digest('hex');
}

/** Constant-time comparison for two hex digests of equal length. */
export function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/** Short, unguessable id for a session (the `sid` JWT claim). */
export function generateSessionId(): string {
  return crypto.randomBytes(16).toString('base64url');
}
