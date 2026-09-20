/**
 * Booking, at the API level.
 *
 * `booking-concurrency.test.ts` proves the database cannot hold two
 * appointments in one slot. This suite covers the layer above: which slots the
 * *service* will accept at all, and the state machine that follows.
 *
 * The distinction matters. The unique index stops a race; it does nothing about
 * a request for 09:07, a slot in the past, or a day the doctor does not work —
 * those are all distinct keys and would insert happily. Those rules live in
 * `assertSlotIsBookable` and are what this file exercises.
 */

import { describe, expect, it } from 'vitest';
import { AppointmentStatus, AppointmentType } from '@pawsitive/shared';
import {
  API,
  anon,
  as,
  dateOnly,
  makeAppointment,
  makeDoctor,
  makePet,
  makeWorld,
  nextSlot,
} from './helpers.js';
import { Appointment } from '../src/models/index.js';

/** Pull a genuinely free slot out of the availability endpoint. */
async function firstFreeSlot(doctorId: string): Promise<string> {
  const response = await anon()
    .get(`${API}/doctors/${doctorId}/slots?from=${dateOnly(1)}&to=${dateOnly(14)}`)
    .expect(200);

  const free = response.body.data.slots.find((slot: { isAvailable: boolean }) => slot.isAvailable);
  expect(free).toBeTruthy();
  return free.start as string;
}

describe('GET /doctors/:id/slots', () => {
  it('returns a slot grid anonymously', async () => {
    const world = await makeWorld();

    const response = await anon()
      .get(`${API}/doctors/${world.doctorA.doctor._id.toString()}/slots?from=${dateOnly(1)}&to=${dateOnly(3)}`)
      .expect(200);

    expect(response.body.data.slots.length).toBeGreaterThan(0);
    expect(response.body.meta.available).toBeGreaterThan(0);
  });

  /**
   * Taken slots are returned flagged, not omitted.
   *
   * A picker that strikes through a booked time reads better than one where it
   * silently disappears — the user learns the doctor is busy rather than closed.
   */
  it('marks a booked slot unavailable rather than hiding it', async () => {
    const world = await makeWorld();
    const slotStart = nextSlot(3);

    await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      slotStart,
    });

    const response = await anon()
      .get(`${API}/doctors/${world.doctorA.doctor._id.toString()}/slots?from=${dateOnly(3)}&to=${dateOnly(3)}`)
      .expect(200);

    const taken = response.body.data.slots.find(
      (slot: { start: string }) => slot.start === slotStart.toISOString(),
    );

    expect(taken).toBeTruthy();
    expect(taken.isAvailable).toBe(false);
  });

  /* The grid exposes times, never who holds a booked one. */
  it('never reveals who booked a slot', async () => {
    const world = await makeWorld();

    await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      slotStart: nextSlot(3),
    });

    const response = await anon()
      .get(`${API}/doctors/${world.doctorA.doctor._id.toString()}/slots?from=${dateOnly(3)}&to=${dateOnly(3)}`)
      .expect(200);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(world.clientA.email);
    expect(serialised).not.toContain('Alphapet');
  });

  /* Unbounded windows are a free way to make the server generate millions of
     slot objects. */
  it('rejects a window wider than the cap', async () => {
    const world = await makeWorld();

    await anon()
      .get(`${API}/doctors/${world.doctorA.doctor._id.toString()}/slots?from=2026-01-01&to=2027-01-01`)
      .expect(400);
  });

  it('shows nothing bookable for a doctor who has closed their books', async () => {
    const world = await makeWorld();
    const closed = await makeDoctor(world.clinicA._id, { isAcceptingPatients: false });

    const response = await anon()
      .get(`${API}/doctors/${closed.doctor._id.toString()}/slots?from=${dateOnly(1)}&to=${dateOnly(3)}`)
      .expect(200);

    expect(response.body.data.slots.length).toBeGreaterThan(0);
    expect(
      response.body.data.slots.every((slot: { isAvailable: boolean }) => !slot.isAvailable),
    ).toBe(true);
  });
});

describe('POST /appointments', () => {
  it('books a free slot and returns a quotable reference', async () => {
    const world = await makeWorld();
    const slotStart = await firstFreeSlot(world.doctorA.doctor._id.toString());

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart,
        type: AppointmentType.CONSULTATION,
        reason: 'Limping on the left hind leg',
      })
      .expect(201);

    expect(response.body.data.reference).toMatch(/^PAW-[2-9A-HJ-NP-Z]{6}$/);
    expect(response.body.data.status).toBe(AppointmentStatus.PENDING);
    /* The fee is taken from the doctor's profile, never from the request. */
    expect(response.body.data.fee.amountMinor).toBe(50_000);
  });

  it('returns 409 when the slot was taken first', async () => {
    const world = await makeWorld();
    const slotStart = await firstFreeSlot(world.doctorA.doctor._id.toString());

    await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart,
        type: AppointmentType.CONSULTATION,
        reason: 'First in',
      })
      .expect(201);

    const response = await as(world.tokens.clientB)
      .post(`${API}/appointments`)
      .send({
        petId: world.petB._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart,
        type: AppointmentType.CONSULTATION,
        reason: 'Second in',
      })
      .expect(409);

    expect(response.body.code).toBe('APPOINTMENT_SLOT_TAKEN');
  });

  /**
   * An off-grid time.
   *
   * The unique index would accept this happily — 10:00 and 10:07 are different
   * keys. It is rejected because the service re-derives the doctor's grid and
   * checks membership.
   */
  it('rejects a time that is not on the doctor’s grid', async () => {
    const world = await makeWorld();
    const onGrid = await firstFreeSlot(world.doctorA.doctor._id.toString());
    const offGrid = new Date(new Date(onGrid).getTime() + 7 * 60_000).toISOString();

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart: offGrid,
        type: AppointmentType.CONSULTATION,
        reason: 'Off-grid time',
      })
      .expect(400);

    expect(response.body.code).toBe('APPOINTMENT_DOCTOR_UNAVAILABLE');
  });

  it('rejects a slot in the past', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart: '2020-01-01T09:00:00.000Z',
        type: AppointmentType.CONSULTATION,
        reason: 'In the past',
      })
      .expect(400);

    expect(response.body.code).toBe('APPOINTMENT_SLOT_PAST');
  });

  it('rejects a slot beyond the advance-booking horizon', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart: nextSlot(400).toISOString(),
        type: AppointmentType.CONSULTATION,
        reason: 'Too far ahead',
      })
      .expect(400);

    expect(response.body.code).toBe('APPOINTMENT_TOO_FAR');
  });

  it('honours a doctor’s minimum-notice window', async () => {
    const world = await makeWorld();
    /* Two days' notice required. */
    const strict = await makeDoctor(world.clinicA._id, { minimumNoticeMinutes: 2880 });

    const response = await anon()
      .get(`${API}/doctors/${strict.doctor._id.toString()}/slots?from=${dateOnly(0)}&to=${dateOnly(1)}`)
      .expect(200);

    /* Everything inside the notice window is clipped out of the grid entirely. */
    expect(response.body.data.slots).toHaveLength(0);
  });

  it("refuses to book another client's pet", async () => {
    const world = await makeWorld();
    const slotStart = await firstFreeSlot(world.doctorA.doctor._id.toString());

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petB._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart,
        type: AppointmentType.CONSULTATION,
        reason: 'Not my pet',
      })
      .expect(404);

    expect(response.body.code).toBe('PET_NOT_FOUND');
  });

  it('refuses a doctor who is not accepting patients', async () => {
    const world = await makeWorld();
    const closed = await makeDoctor(world.clinicA._id, { isAcceptingPatients: false });

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: closed.doctor._id.toString(),
        slotStart: nextSlot(3).toISOString(),
        type: AppointmentType.CONSULTATION,
        reason: 'Doctor has closed their books',
      })
      .expect(409);

    expect(response.body.code).toBe('DOCTOR_NOT_ACCEPTING_PATIENTS');
  });

  /* A pet cannot be in two consulting rooms at once. */
  it('refuses to double-book the same pet with two doctors', async () => {
    const world = await makeWorld();
    const second = await makeDoctor(world.clinicA._id);
    const slotStart = nextSlot(4).toISOString();

    await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart,
        type: AppointmentType.CONSULTATION,
        reason: 'First doctor',
      })
      .expect(201);

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments`)
      .send({
        petId: world.petA._id.toString(),
        doctorId: second.doctor._id.toString(),
        slotStart,
        type: AppointmentType.CONSULTATION,
        reason: 'Second doctor, same moment',
      })
      .expect(409);

    expect(response.body.code).toBe('APPOINTMENT_SLOT_TAKEN');
  });
});

describe('the appointment state machine', () => {
  async function pendingAppointment() {
    const world = await makeWorld();

    const appointment = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
    });

    return { world, appointment };
  }

  it('lets a doctor confirm a pending appointment', async () => {
    const { world, appointment } = await pendingAppointment();

    const response = await as(world.tokens.doctorA)
      .patch(`${API}/appointments/${appointment._id.toString()}/status`)
      .send({ status: AppointmentStatus.CONFIRMED })
      .expect(200);

    expect(response.body.data.status).toBe(AppointmentStatus.CONFIRMED);
    expect(response.body.data.confirmedAt).toBeTruthy();
  });

  /* `pending → completed` is not an edge in the graph. */
  it('refuses an illegal jump in the graph', async () => {
    const { world, appointment } = await pendingAppointment();

    const response = await as(world.tokens.doctorA)
      .patch(`${API}/appointments/${appointment._id.toString()}/status`)
      .send({ status: AppointmentStatus.COMPLETED })
      .expect(409);

    expect(response.body.code).toBe('APPOINTMENT_INVALID_TRANSITION');
  });

  it('walks the full lifecycle', async () => {
    const { world, appointment } = await pendingAppointment();
    const url = `${API}/appointments/${appointment._id.toString()}/status`;

    for (const status of [
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.IN_PROGRESS,
      AppointmentStatus.COMPLETED,
    ]) {
      await as(world.tokens.doctorA).patch(url).send({ status }).expect(200);
    }

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored?.status).toBe(AppointmentStatus.COMPLETED);
    expect(stored?.startedAt).toBeTruthy();
    expect(stored?.completedAt).toBeTruthy();
  });

  it('refuses any transition out of a terminal state', async () => {
    const { world, appointment } = await pendingAppointment();

    await Appointment.updateOne(
      { _id: appointment._id },
      { $set: { status: AppointmentStatus.COMPLETED, blocksSlot: false } },
    );

    const response = await as(world.tokens.doctorA)
      .patch(`${API}/appointments/${appointment._id.toString()}/status`)
      .send({ status: AppointmentStatus.CONFIRMED })
      .expect(409);

    expect(response.body.code).toBe('APPOINTMENT_ALREADY_TERMINAL');
  });
});

describe('cancellation', () => {
  it('lets a client cancel with enough notice and frees the slot', async () => {
    const world = await makeWorld();
    const slotStart = nextSlot(5);

    const appointment = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      slotStart,
    });

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments/${appointment._id.toString()}/cancel`)
      .send({ reason: 'Plans changed' })
      .expect(200);

    expect(response.body.data.status).toBe(AppointmentStatus.CANCELLED);
    expect(response.body.data.cancelledBy).toBe('client');

    /* The slot must be bookable again — this is what `blocksSlot` controls. */
    const grid = await anon()
      .get(`${API}/doctors/${world.doctorA.doctor._id.toString()}/slots?from=${dateOnly(5)}&to=${dateOnly(5)}`)
      .expect(200);

    const freed = grid.body.data.slots.find(
      (slot: { start: string }) => slot.start === slotStart.toISOString(),
    );
    expect(freed?.isAvailable).toBe(true);

    /* And another client can actually take it. */
    await as(world.tokens.clientB)
      .post(`${API}/appointments`)
      .send({
        petId: world.petB._id.toString(),
        doctorId: world.doctorA.doctor._id.toString(),
        slotStart: slotStart.toISOString(),
        type: AppointmentType.CONSULTATION,
        reason: 'Taking the freed slot',
      })
      .expect(201);
  });

  /**
   * The cutoff applies to clients only.
   *
   * Staff must always be able to close out a visit the client abandoned twenty
   * minutes before it started — the window exists to stop last-minute
   * self-service cancellations, not to stop the clinic managing its calendar.
   */
  it('refuses a client cancelling inside the cutoff', async () => {
    const world = await makeWorld();

    const appointment = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      /* Thirty minutes away — inside the two-hour window. */
      slotStart: new Date(Date.now() + 30 * 60_000),
    });

    const response = await as(world.tokens.clientA)
      .post(`${API}/appointments/${appointment._id.toString()}/cancel`)
      .send({ reason: 'Too late' })
      .expect(403);

    expect(response.body.code).toBe('APPOINTMENT_CANCELLATION_WINDOW_PASSED');
  });

  it('lets staff cancel inside the cutoff', async () => {
    const world = await makeWorld();

    const appointment = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      slotStart: new Date(Date.now() + 30 * 60_000),
    });

    await as(world.tokens.adminA)
      .post(`${API}/appointments/${appointment._id.toString()}/cancel`)
      .send({ reason: 'Client called the clinic' })
      .expect(200);
  });
});

describe('rescheduling', () => {
  /**
   * Reschedule is cancel-and-recreate, and the two records are linked.
   *
   * An in-place `slotStart` update races the same way a booking does, but a
   * failed update would leave the original already mutated. Creating the
   * replacement first means a lost race changes nothing.
   */
  it('creates a linked replacement and releases the original slot', async () => {
    const world = await makeWorld();
    const original = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      slotStart: nextSlot(6),
    });

    const newSlot = nextSlot(8).toISOString();

    const response = await as(world.tokens.clientA)
      .patch(`${API}/appointments/${original._id.toString()}/reschedule`)
      .send({ slotStart: newSlot, reason: 'Something came up' })
      .expect(200);

    expect(response.body.data.slotStart).toBe(newSlot);
    expect(response.body.data.rescheduledFrom).toBe(original._id.toString());

    const stored = await Appointment.findById(original._id).lean();
    expect(stored?.status).toBe(AppointmentStatus.CANCELLED);
    expect(stored?.rescheduledTo?.toString()).toBe(response.body.data.id);
    /* Released, so the original time is bookable again. */
    expect(stored?.blocksSlot).toBe(false);
  });

  it('leaves the original untouched when the new slot is taken', async () => {
    const world = await makeWorld();
    const contested = nextSlot(9);

    /* Clinic A's other client takes the target slot first. */
    const blocker = await makePet(world.clientB._id, 'Blocker');
    await makeAppointment({
      clientId: world.clientB._id,
      petId: blocker._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      slotStart: contested,
    });

    const original = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
      slotStart: nextSlot(6),
    });

    await as(world.tokens.clientA)
      .patch(`${API}/appointments/${original._id.toString()}/reschedule`)
      .send({ slotStart: contested.toISOString() })
      .expect(409);

    /* The important assertion: a failed reschedule is a no-op. */
    const stored = await Appointment.findById(original._id).lean();
    expect(stored?.status).toBe(AppointmentStatus.PENDING);
    expect(stored?.slotStart.toISOString()).toBe(nextSlot(6).toISOString());
    expect(stored?.rescheduledTo).toBeNull();
  });
});
