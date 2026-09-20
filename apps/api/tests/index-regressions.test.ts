/**
 * Regression tests for two index/query bugs that both presented as something
 * entirely unrelated to their cause. Each is cheap to reintroduce and
 * expensive to diagnose, so they are pinned here.
 */

import mongoose, { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { Pet } from '../src/models/pet.model.js';
import { RefreshToken } from '../src/models/refresh-token.model.js';
import { User } from '../src/models/user.model.js';

function userPayload(email: string) {
  return {
    firstName: 'Test',
    lastName: 'User',
    email,
    passwordHash: 'scrypt$32768$8$1$c2FsdA==$aGFzaA==',
    role: 'client' as const,
  };
}

/**
 * `sparse: true` vs `partialFilterExpression`.
 *
 * A sparse unique index omits documents where the field is *missing*. It does
 * **not** omit documents where the field is present and explicitly `null`.
 * `inviteTokenHash`, `passwordResetTokenHash` and `microchipId` all declare
 * `default: null`, so with sparse indexes the *second* row ever inserted
 * collided on null.
 *
 * The symptom was memorable: the second user registration on a fresh database
 * failed with "duplicate key error … inviteTokenHash: null" — on a route that
 * has nothing to do with invitations.
 */
describe('nullable unique indexes', () => {
  it('allows many users with no pending invite', async () => {
    const created = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        User.create(userPayload(`invite-${index}@example.com`)),
      ),
    );

    expect(created).toHaveLength(5);
    /* All of them should hold an explicit null, which is the condition that
       broke the sparse index. */
    expect(created.every((user) => user.inviteTokenHash === null)).toBe(true);
  });

  it('allows many users with no pending password reset', async () => {
    await expect(
      Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          User.create(userPayload(`reset-${index}@example.com`)),
        ),
      ),
    ).resolves.toHaveLength(5);
  });

  it('still rejects two users sharing an actual invite token', async () => {
    await User.create({ ...userPayload('a@example.com'), inviteTokenHash: 'shared-token-hash' });

    await expect(
      User.create({ ...userPayload('b@example.com'), inviteTokenHash: 'shared-token-hash' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows many pets with no microchip', async () => {
    const owner = new Types.ObjectId();

    const pets = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        Pet.create({ owner, name: `Pet ${index}`, species: 'dog' }),
      ),
    );

    expect(pets).toHaveLength(5);
  });

  it('still rejects two pets sharing a microchip number', async () => {
    const owner = new Types.ObjectId();

    await Pet.create({ owner, name: 'Rex', species: 'dog', microchipId: '900123456789012' });

    await expect(
      Pet.create({ owner, name: 'Max', species: 'cat', microchipId: '900123456789012' }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('treats an empty microchip string as absent', async () => {
    const owner = new Types.ObjectId();

    /* Two empty strings WOULD collide on a unique index — the model normalises
       them to null in a pre-save hook precisely to avoid that. */
    await Pet.create({ owner, name: 'Blank One', species: 'dog', microchipId: '' });
    const second = await Pet.create({ owner, name: 'Blank Two', species: 'cat', microchipId: '' });

    expect(second.microchipId).toBeNull();
  });
});

/**
 * `mongoose.set('sanitizeFilter', true)` breaks query operators.
 *
 * It wraps every object-valued filter in `$eq`, so `{ $gt: date }` becomes
 * `{ $eq: { $gt: date } }` and fails to cast. It was enabled globally, which
 * silently broke the session-liveness check — and therefore *every*
 * authenticated request — while every unauthenticated path kept working.
 *
 * This test fails loudly if anyone turns it back on.
 */
describe('query operators are not mangled', () => {
  it('supports a $gt date comparison', async () => {
    const userId = new Types.ObjectId();

    await RefreshToken.create({
      user: userId,
      tokenHash: 'live-token-hash',
      family: 'family-1',
      sessionId: 'session-1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await RefreshToken.create({
      user: userId,
      tokenHash: 'expired-token-hash',
      family: 'family-2',
      sessionId: 'session-2',
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    /* Exactly the shape `isSessionActive()` uses. */
    const live = await RefreshToken.exists({
      sessionId: 'session-1',
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });

    const expired = await RefreshToken.exists({
      sessionId: 'session-2',
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    });

    expect(live).not.toBeNull();
    expect(expired).toBeNull();
  });

  it('supports $in, $lt and $ne', async () => {
    const owner = new Types.ObjectId();
    await Pet.create({ owner, name: 'Rex', species: 'dog' });
    await Pet.create({ owner, name: 'Whiskers', species: 'cat' });
    await Pet.create({ owner, name: 'Polly', species: 'bird' });

    await expect(
      Pet.countDocuments({ owner, species: { $in: ['dog', 'cat'] } }),
    ).resolves.toBe(2);

    await expect(Pet.countDocuments({ owner, species: { $ne: 'dog' } })).resolves.toBe(2);

    await expect(
      Pet.countDocuments({ owner, createdAt: { $lt: new Date(Date.now() + 60_000) } }),
    ).resolves.toBe(3);
  });

  it('supports the _id range scan cursor pagination relies on', async () => {
    const owner = new Types.ObjectId();
    const first = await Pet.create({ owner, name: 'First', species: 'dog' });
    await Pet.create({ owner, name: 'Second', species: 'cat' });

    await expect(Pet.countDocuments({ _id: { $gt: first._id } })).resolves.toBe(1);
  });
});

describe('declared indexes actually exist', () => {
  /**
   * Guards against an index being declared in the schema but never built —
   * which would leave the uniqueness "guarantees" as comments rather than
   * constraints, with no visible symptom until two rows collide in production.
   */
  it('creates the appointment slot indexes', async () => {
    const indexes = await mongoose.connection.collection('appointments').indexes();
    const names = indexes.map((index) => index.name);

    expect(names).toContain('uniq_doctor_slot_active');
    expect(names).toContain('uniq_pet_slot_active');
  });

  it('scopes the slot indexes to occupying appointments only', async () => {
    const indexes = await mongoose.connection.collection('appointments').indexes();
    const doctorSlot = indexes.find((index) => index.name === 'uniq_doctor_slot_active');

    expect(doctorSlot?.unique).toBe(true);
    expect(doctorSlot?.partialFilterExpression).toEqual({ blocksSlot: true });
  });

  it('uses a partial filter, not sparse, for nullable unique fields', async () => {
    const userIndexes = await mongoose.connection.collection('users').indexes();
    const invite = userIndexes.find((index) => index.name === 'invite_token');

    expect(invite?.unique).toBe(true);
    expect(invite?.sparse).toBeUndefined();
    expect(invite?.partialFilterExpression).toEqual({ inviteTokenHash: { $type: 'string' } });
  });
});
