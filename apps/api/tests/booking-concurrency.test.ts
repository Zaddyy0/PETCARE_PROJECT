/**
 * The double-booking guarantee.
 *
 * This is the most important test in the codebase. The entire booking model
 * rests on the claim that MongoDB — not application code — makes it impossible
 * for two clients to hold the same doctor's slot. That claim is only worth
 * anything if it is demonstrated against a real database under real
 * concurrency, so these tests fire genuinely parallel writes and assert that
 * exactly one wins.
 *
 * A mocked database would pass all of this while production silently
 * double-booked, which is precisely why `tests/setup.ts` uses a real ephemeral
 * MongoDB instead.
 */

import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { AppointmentStatus, AppointmentType } from '@pawsitive/shared';
import { Appointment, isSlotConflictError } from '../src/models/appointment.model.js';

/** A fixed cast of ids, so each test controls exactly what collides. */
function ids() {
  return {
    client: new Types.ObjectId(),
    pet: new Types.ObjectId(),
    doctor: new Types.ObjectId(),
    clinic: new Types.ObjectId(),
  };
}

interface BookingOverrides {
  client?: Types.ObjectId;
  pet?: Types.ObjectId;
  doctor?: Types.ObjectId;
  clinic?: Types.ObjectId;
  slotStart?: Date;
  status?: (typeof AppointmentStatus)[keyof typeof AppointmentStatus];
}

function bookingPayload(base: ReturnType<typeof ids>, overrides: BookingOverrides = {}) {
  return {
    client: overrides.client ?? base.client,
    pet: overrides.pet ?? base.pet,
    doctor: overrides.doctor ?? base.doctor,
    clinic: overrides.clinic ?? base.clinic,
    slotStart: overrides.slotStart ?? new Date('2026-11-02T09:00:00.000Z'),
    durationMinutes: 30,
    type: AppointmentType.CONSULTATION,
    reason: 'Annual check-up',
    status: overrides.status ?? AppointmentStatus.PENDING,
    feeAmountMinor: 50_000,
    feeCurrency: 'INR',
    createdBy: overrides.client ?? base.client,
  };
}

describe('double-booking prevention', () => {
  it('rejects a second appointment for the same doctor at the same instant', async () => {
    const base = ids();

    await Appointment.create(bookingPayload(base));

    /* A different client, a different pet — same doctor, same moment. */
    await expect(
      Appointment.create(
        bookingPayload(base, { client: new Types.ObjectId(), pet: new Types.ObjectId() }),
      ),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('identifies the conflict as a doctor clash', async () => {
    const base = ids();
    await Appointment.create(bookingPayload(base));

    try {
      await Appointment.create(
        bookingPayload(base, { client: new Types.ObjectId(), pet: new Types.ObjectId() }),
      );
      expect.unreachable('the second booking should have been rejected');
    } catch (error) {
      expect(isSlotConflictError(error)).toBe('doctor');
    }
  });

  it('rejects the same pet being booked with two doctors at once', async () => {
    const base = ids();
    await Appointment.create(bookingPayload(base));

    try {
      /* Same pet, different doctor, same time — a pet cannot be in two rooms. */
      await Appointment.create(bookingPayload(base, { doctor: new Types.ObjectId() }));
      expect.unreachable('the second booking should have been rejected');
    } catch (error) {
      expect(isSlotConflictError(error)).toBe('pet');
    }
  });

  /**
   * The race the unique index exists for.
   *
   * Twenty simultaneous attempts on one slot. A check-then-insert in
   * application code passes its check in all twenty before any of them writes,
   * and creates twenty appointments. The database must admit exactly one.
   */
  it('admits exactly one winner when 20 clients race for the same slot', async () => {
    const base = ids();
    const contenders = 20;

    const results = await Promise.allSettled(
      Array.from({ length: contenders }, () =>
        Appointment.create(
          bookingPayload(base, {
            client: new Types.ObjectId(),
            pet: new Types.ObjectId(),
          }),
        ),
      ),
    );

    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(contenders - 1);

    /* Every loser must fail for the *right* reason — a duplicate key on the
       doctor-slot index, not a validation error that happens to look similar. */
    for (const failure of failed) {
      expect(isSlotConflictError((failure as PromiseRejectedResult).reason)).toBe('doctor');
    }

    /* And the database holds exactly one row, not one-per-lucky-write. */
    await expect(Appointment.countDocuments({ doctor: base.doctor })).resolves.toBe(1);
  });

  it('allows a different doctor at the same time', async () => {
    const base = ids();
    await Appointment.create(bookingPayload(base));

    await expect(
      Appointment.create(
        bookingPayload(base, { doctor: new Types.ObjectId(), pet: new Types.ObjectId() }),
      ),
    ).resolves.toBeDefined();
  });

  it('allows the same doctor at a different time', async () => {
    const base = ids();
    await Appointment.create(bookingPayload(base));

    await expect(
      Appointment.create(
        bookingPayload(base, { slotStart: new Date('2026-11-02T09:30:00.000Z') }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('slot release on cancellation', () => {
  it('frees the slot once an appointment is cancelled', async () => {
    const base = ids();
    const first = await Appointment.create(bookingPayload(base));

    /* Occupied, so a rebooking must fail. */
    await expect(
      Appointment.create(
        bookingPayload(base, { client: new Types.ObjectId(), pet: new Types.ObjectId() }),
      ),
    ).rejects.toMatchObject({ code: 11000 });

    first.status = AppointmentStatus.CANCELLED;
    await first.save();

    /* `blocksSlot` should now be false, taking the row out of the partial index. */
    const reloaded = await Appointment.findById(first._id).lean();
    expect(reloaded?.blocksSlot).toBe(false);

    await expect(
      Appointment.create(
        bookingPayload(base, { client: new Types.ObjectId(), pet: new Types.ObjectId() }),
      ),
    ).resolves.toBeDefined();
  });

  /**
   * A completed visit leaves the slot index.
   *
   * This is deliberate, and worth being explicit about since it looks like a
   * hole. Keeping completed appointments in the partial index would mean it
   * eventually contains *every appointment ever booked* — which defeats the
   * point of the partial filter and makes the index grow without bound.
   *
   * It is safe because nothing can occupy a past slot anyway: the booking
   * service rejects a `slotStart` in the past, and separately enforces the
   * doctor's minimum-notice window. By the time an appointment reaches
   * `completed`, its slot is behind us. The index guards *future* contention;
   * the service guards the past.
   */
  it('removes a completed appointment from the slot index', async () => {
    const base = ids();
    const first = await Appointment.create(bookingPayload(base));

    for (const status of [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.COMPLETED,
    ]) {
      first.status = status;
      await first.save();
    }

    const reloaded = await Appointment.findById(first._id).lean();
    expect(reloaded?.status).toBe(AppointmentStatus.COMPLETED);
    expect(reloaded?.blocksSlot).toBe(false);
  });

  it('keeps the slot locked while an appointment is in progress', async () => {
    const base = ids();
    const first = await Appointment.create(bookingPayload(base));

    first.status = AppointmentStatus.CONFIRMED;
    await first.save();
    first.status = AppointmentStatus.IN_PROGRESS;
    await first.save();

    expect(first.blocksSlot).toBe(true);

    await expect(
      Appointment.create(
        bookingPayload(base, { client: new Types.ObjectId(), pet: new Types.ObjectId() }),
      ),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('releases the slot through findOneAndUpdate too, not just save()', async () => {
    const base = ids();
    const first = await Appointment.create(bookingPayload(base));

    /* Update queries bypass `pre('save')`. The query hook must cover them, or a
       cancellation made this way would leave the slot locked forever. */
    await Appointment.findByIdAndUpdate(first._id, {
      $set: { status: AppointmentStatus.CANCELLED },
    });

    const reloaded = await Appointment.findById(first._id).lean();
    expect(reloaded?.status).toBe(AppointmentStatus.CANCELLED);
    expect(reloaded?.blocksSlot).toBe(false);

    await expect(
      Appointment.create(
        bookingPayload(base, { client: new Types.ObjectId(), pet: new Types.ObjectId() }),
      ),
    ).resolves.toBeDefined();
  });
});

describe('derived fields', () => {
  it('computes slotEnd from slotStart and duration', async () => {
    const base = ids();
    const appointment = await Appointment.create(bookingPayload(base));

    expect(appointment.slotEnd.toISOString()).toBe('2026-11-02T09:30:00.000Z');
  });

  it('generates a unique human-quotable reference', async () => {
    const base = ids();
    const appointment = await Appointment.create(bookingPayload(base));

    expect(appointment.reference).toMatch(/^PAW-[2-9A-HJ-NP-Z]{6}$/);
  });

  it('marks a new pending appointment as occupying its slot', async () => {
    const base = ids();
    const appointment = await Appointment.create(bookingPayload(base));

    expect(appointment.blocksSlot).toBe(true);
  });
});
