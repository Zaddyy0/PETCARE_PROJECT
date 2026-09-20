/**
 * Authentication.
 *
 * Most of these assert on things that are easy to regress silently — a
 * credential appearing in a response, an error message that distinguishes
 * "no such user" from "wrong password", a token that verifies when it should
 * not. None of them would show up as a broken feature.
 */

import { describe, expect, it } from 'vitest';
import { Role, UserStatus } from '@pawsitive/shared';
import { API, TEST_PASSWORD, anon, as, authFor, makeUser } from './helpers.js';
import { User } from '../src/models/index.js';
import { RefreshToken } from '../src/models/refresh-token.model.js';

describe('POST /auth/register', () => {
  it('creates a client and returns a session', async () => {
    const response = await anon()
      .post(`${API}/auth/register`)
      .send({
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@test.local',
        password: TEST_PASSWORD,
        acceptedTerms: true,
      })
      .expect(201);

    expect(response.body.data.user.role).toBe(Role.CLIENT);
    expect(response.body.data.tokens.accessToken).toBeTruthy();
  });

  /**
   * Self-registration always creates a client.
   *
   * The role is hardcoded in the service rather than read from the payload. If
   * it were ever read from input, this request would mint a super admin.
   */
  it('ignores a role supplied in the payload', async () => {
    const response = await anon()
      .post(`${API}/auth/register`)
      .send({
        firstName: 'Mal',
        lastName: 'Icious',
        email: 'mal@test.local',
        password: TEST_PASSWORD,
        acceptedTerms: true,
        role: Role.SUPER_ADMIN,
        status: UserStatus.ACTIVE,
        clinicId: '507f1f77bcf86cd799439011',
      })
      .expect(201);

    expect(response.body.data.user.role).toBe(Role.CLIENT);

    const stored = await User.findOne({ email: 'mal@test.local' }).lean();
    expect(stored?.role).toBe(Role.CLIENT);
    expect(stored?.clinic).toBeNull();
  });

  it('never returns a password hash', async () => {
    const response = await anon()
      .post(`${API}/auth/register`)
      .send({
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@test.local',
        password: TEST_PASSWORD,
        acceptedTerms: true,
      })
      .expect(201);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/passwordHash/);
    expect(serialised).not.toMatch(/scrypt\$/);
  });

  /** The refresh token belongs in an httpOnly cookie, never in the body. */
  it('puts the refresh token in an httpOnly cookie and not in the body', async () => {
    const response = await anon()
      .post(`${API}/auth/register`)
      .send({
        firstName: 'Alan',
        lastName: 'Turing',
        email: 'alan@test.local',
        password: TEST_PASSWORD,
        acceptedTerms: true,
      })
      .expect(201);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const refreshCookie = cookies?.find((cookie) => cookie.startsWith('pawsitive_rt='));

    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie?.toLowerCase()).toContain('httponly');
    expect(response.body.data.tokens.refreshToken).toBeUndefined();
  });

  it('rejects a weak password with a field-scoped error', async () => {
    const response = await anon()
      .post(`${API}/auth/register`)
      .send({
        firstName: 'Weak',
        lastName: 'Password',
        email: 'weak@test.local',
        password: 'short',
        acceptedTerms: true,
      })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(response.body.errors.some((error: { field: string }) => error.field === 'password')).toBe(
      true,
    );
  });

  it('rejects a duplicate email', async () => {
    await makeUser({ email: 'taken@test.local' });

    const response = await anon()
      .post(`${API}/auth/register`)
      .send({
        firstName: 'Dupe',
        lastName: 'User',
        email: 'taken@test.local',
        password: TEST_PASSWORD,
        acceptedTerms: true,
      })
      .expect(409);

    expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  /* Four registrations in a row. Guards the nullable-unique-index regression:
     with `sparse` instead of a partial filter, the second one fails. */
  it('allows several registrations in succession', async () => {
    for (let index = 0; index < 4; index += 1) {
      await anon()
        .post(`${API}/auth/register`)
        .send({
          firstName: 'Bulk',
          lastName: 'Tester',
          email: `bulk-${index}@test.local`,
          password: TEST_PASSWORD,
          acceptedTerms: true,
        })
        .expect(201);
    }

    await expect(User.countDocuments({ email: /^bulk-/ })).resolves.toBe(4);
  });
});

describe('POST /auth/login', () => {
  it('signs in with correct credentials', async () => {
    const user = await makeUser({ email: 'login@test.local' });

    const response = await anon()
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.data.tokens.accessToken).toBeTruthy();
    expect(response.body.data.user.email).toBe('login@test.local');
  });

  /**
   * User enumeration.
   *
   * An unknown address and a wrong password must be indistinguishable — same
   * status, same code, same message. Anything else turns a credential-stuffing
   * list into a validated list of real accounts.
   */
  it('does not reveal whether an email is registered', async () => {
    const user = await makeUser({ email: 'known@test.local' });

    const wrongPassword = await anon()
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: 'WrongPassword123!' })
      .expect(401);

    const unknownEmail = await anon()
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@test.local', password: TEST_PASSWORD })
      .expect(401);

    expect(unknownEmail.body.code).toBe(wrongPassword.body.code);
    expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
  });

  it('refuses a suspended account and explains why', async () => {
    const user = await makeUser({
      email: 'suspended@test.local',
      status: UserStatus.SUSPENDED,
    });

    await User.updateOne({ _id: user._id }, { $set: { suspendedReason: 'Policy breach' } });

    const response = await anon()
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(403);

    expect(response.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('refuses an invited account that has not accepted yet', async () => {
    const user = await makeUser({ email: 'invited@test.local', status: UserStatus.INVITED });

    const response = await anon()
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD })
      .expect(401);

    expect(response.body.code).toBe('ACCOUNT_NOT_VERIFIED');
  });

  /* Per-account lockout, distinct from per-IP rate limiting (which is disabled
     under NODE_ENV=test so it cannot mask this). */
  it('locks the account after repeated failures', async () => {
    const user = await makeUser({ email: 'lockme@test.local' });

    let locked = false;

    for (let attempt = 0; attempt < 7; attempt += 1) {
      const response = await anon()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'Wrong123!Wrong' });

      if (response.body.code === 'ACCOUNT_LOCKED') {
        locked = true;
        break;
      }
    }

    expect(locked).toBe(true);

    /* Even the correct password is refused while locked. */
    const afterLock = await anon()
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(afterLock.body.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('GET /auth/me', () => {
  it('requires a token', async () => {
    const response = await anon().get(`${API}/auth/me`).expect(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  it('returns the caller with their resolved permissions', async () => {
    const user = await makeUser({ email: 'me@test.local' });
    const token = await authFor(user);

    const response = await as(token).get(`${API}/auth/me`).expect(200);

    expect(response.body.data.email).toBe('me@test.local');
    expect(response.body.data.permissions).toContain('pet:create');
    /* A client must never hold clinical write access. */
    expect(response.body.data.permissions).not.toContain('medical_record:write');
  });

  it('rejects a garbage token', async () => {
    await as('not.a.jwt').get(`${API}/auth/me`).expect(401);
  });

  /**
   * Algorithm confusion.
   *
   * `jsonwebtoken` will honour whatever `alg` the token's own header claims
   * unless the verifier pins one. An `alg: none` token with a forged payload
   * would otherwise authenticate as anybody.
   */
  it('rejects an alg:none token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ sub: '507f1f77bcf86cd799439011', role: Role.SUPER_ADMIN, sid: 'x' }),
    ).toString('base64url');

    await as(`${header}.${payload}.`).get(`${API}/auth/me`).expect(401);
  });

  it('rejects a tampered signature', async () => {
    const user = await makeUser();
    const token = await authFor(user);

    await as(`${token.slice(0, -3)}AAA`).get(`${API}/auth/me`).expect(401);
  });

  /**
   * Session revocation takes effect immediately.
   *
   * A JWT cannot be un-signed, so without the session check a signed-out or
   * suspended user would keep working until their token expired.
   */
  it('rejects a token whose session was revoked', async () => {
    const user = await makeUser();
    const token = await authFor(user);

    await as(token).get(`${API}/auth/me`).expect(200);

    await RefreshToken.updateMany(
      { user: user._id },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
    );

    const response = await as(token).get(`${API}/auth/me`).expect(401);
    expect(response.body.code).toBe('SESSION_REVOKED');
  });

  /** The role comes from the database, not the token's stale claim. */
  it('reflects a role change without reissuing the token', async () => {
    const user = await makeUser({ role: Role.CLIENT });
    const token = await authFor(user);

    await User.updateOne({ _id: user._id }, { $set: { role: Role.DOCTOR } });

    const response = await as(token).get(`${API}/auth/me`).expect(200);
    expect(response.body.data.role).toBe(Role.DOCTOR);
  });
});

describe('POST /auth/forgot-password', () => {
  /* Identical response either way — same enumeration concern as sign-in. */
  it('responds identically for known and unknown addresses', async () => {
    await makeUser({ email: 'real@test.local' });

    const known = await anon()
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'real@test.local' })
      .expect(200);

    const unknown = await anon()
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'ghost@test.local' })
      .expect(200);

    expect(unknown.body.message).toBe(known.body.message);
  });

  it('stores the reset token hashed, never in plaintext', async () => {
    const user = await makeUser({ email: 'reset@test.local' });

    await anon().post(`${API}/auth/forgot-password`).send({ email: user.email }).expect(200);

    const stored = await User.findById(user._id)
      .select('+passwordResetTokenHash +passwordResetExpiresAt')
      .lean();

    expect(stored?.passwordResetTokenHash).toBeTruthy();
    /* A 64-character hex digest, not a base64url token. */
    expect(stored?.passwordResetTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.passwordResetExpiresAt).toBeInstanceOf(Date);
  });
});

describe('POST /auth/impersonate', () => {
  it('is refused for a client', async () => {
    const client = await makeUser({ role: Role.CLIENT });
    const target = await makeUser({ role: Role.CLIENT });
    const token = await authFor(client);

    await as(token)
      .post(`${API}/auth/impersonate`)
      .send({ userId: target._id.toString(), reason: 'Trying it on as a client' })
      .expect(403);
  });

  it('is refused for an admin', async () => {
    const admin = await makeUser({ role: Role.ADMIN });
    const target = await makeUser({ role: Role.CLIENT });
    const token = await authFor(admin);

    await as(token)
      .post(`${API}/auth/impersonate`)
      .send({ userId: target._id.toString(), reason: 'Trying it on as an admin' })
      .expect(403);
  });

  it('lets a super admin impersonate a client, flagged and attributed', async () => {
    const superAdmin = await makeUser({ role: Role.SUPER_ADMIN });
    const target = await makeUser({ role: Role.CLIENT });
    const token = await authFor(superAdmin);

    const response = await as(token)
      .post(`${API}/auth/impersonate`)
      .send({ userId: target._id.toString(), reason: 'Investigating a support ticket' })
      .expect(200);

    expect(response.body.data.user.id).toBe(target._id.toString());
    expect(response.body.data.user.isImpersonating).toBe(true);
    expect(response.body.data.user.impersonatedBy).toBe(superAdmin._id.toString());
  });

  it('refuses to impersonate another super admin', async () => {
    const superAdmin = await makeUser({ role: Role.SUPER_ADMIN });
    const peer = await makeUser({ role: Role.SUPER_ADMIN });
    const token = await authFor(superAdmin);

    const response = await as(token)
      .post(`${API}/auth/impersonate`)
      .send({ userId: peer._id.toString(), reason: 'Trying to impersonate a peer' })
      .expect(403);

    expect(response.body.code).toBe('CANNOT_ACT_ON_ROLE');
  });

  it('refuses self-impersonation with a clear message', async () => {
    const superAdmin = await makeUser({ role: Role.SUPER_ADMIN });
    const token = await authFor(superAdmin);

    const response = await as(token)
      .post(`${API}/auth/impersonate`)
      .send({ userId: superAdmin._id.toString(), reason: 'Impersonating myself' })
      .expect(400);

    expect(response.body.message).toMatch(/already signed in as yourself/i);
  });
});
