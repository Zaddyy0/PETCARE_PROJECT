/**
 * Medical records, vaccinations and reviews.
 *
 * The recurring theme is that holding a permission is never enough. Every
 * doctor holds `medical_record:write`; only the *treating* clinician may use it
 * on a given patient, and only the *authoring* clinician may amend a note.
 * Those distinctions are invisible in the permission matrix and entirely
 * enforced in the services, so they need covering here.
 */

import { describe, expect, it } from 'vitest';
import { AppointmentStatus, MEDICAL, REVIEWS } from '@pawsitive/shared';
import {
  API,
  anon,
  as,
  authFor,
  makeAppointment,
  makeDoctor,
  makeWorld,
  nextSlot,
} from './helpers.js';
import { Appointment, MedicalRecord, Doctor, Review } from '../src/models/index.js';

/** A completed visit is the precondition for most clinical writes. */
async function completedVisit() {
  const world = await makeWorld();

  const appointment = await makeAppointment({
    clientId: world.clientA._id,
    petId: world.petA._id,
    doctorId: world.doctorA.doctor._id,
    clinicId: world.clinicA._id,
    slotStart: nextSlot(-3),
    status: AppointmentStatus.COMPLETED,
  });

  return { world, appointment };
}

const recordBody = {
  chiefComplaint: 'Owner reports intermittent lameness on the left hind limb.',
  diagnosis: 'Mild cranial cruciate ligament strain.',
  treatment: 'Rest for two weeks, NSAID course, recheck in fourteen days.',
};

describe('POST /medical/records', () => {
  it('lets the treating clinician write up a visit', async () => {
    const { world, appointment } = await completedVisit();

    const response = await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        ...recordBody,
        vitals: { weightKg: 29.8, temperatureCelsius: 38.6, heartRateBpm: 92 },
        prescriptions: [
          {
            medication: 'Carprofen',
            dosage: '2mg/kg',
            frequency: 'Twice daily',
            durationDays: 14,
            route: 'Oral',
          },
        ],
      })
      .expect(201);

    expect(response.body.data.isEditable).toBe(true);
    expect(response.body.data.amendments).toHaveLength(0);
    expect(response.body.data.prescriptions[0].medication).toBe('Carprofen');

    /* The appointment is flagged, so the UI knows the visit is written up. */
    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored?.hasMedicalRecord).toBe(true);
  });

  it('refuses a client', async () => {
    const { world } = await completedVisit();

    await as(world.tokens.clientA)
      .post(`${API}/medical/records`)
      .send({ petId: world.petA._id.toString(), type: 'consultation', ...recordBody })
      .expect(403);
  });

  /**
   * Admins deliberately cannot author clinical content.
   *
   * They hold `medical_record:read:clinic` but not `:write` — clinical
   * authorship stays with licensed clinicians. This is a product decision, not
   * an oversight, so it is pinned.
   */
  it('refuses an admin', async () => {
    const { world } = await completedVisit();

    await as(world.tokens.adminA)
      .post(`${API}/medical/records`)
      .send({ petId: world.petA._id.toString(), type: 'consultation', ...recordBody })
      .expect(403);
  });

  /* Holding the permission is not the same as treating the patient. */
  it("refuses a doctor with no care relationship to the pet", async () => {
    const { world } = await completedVisit();

    await as(world.tokens.doctorB)
      .post(`${API}/medical/records`)
      .send({ petId: world.petA._id.toString(), type: 'consultation', ...recordBody })
      .expect(404);
  });

  it("refuses to attach a record to another clinician's appointment", async () => {
    const { world, appointment } = await completedVisit();
    const colleague = await makeDoctor(world.clinicA._id);
    const colleagueToken = await authFor(colleague.user);

    /* Give the colleague a care relationship so the pet is reachable, then try
       to attach to a visit that is not theirs. */
    await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: colleague.doctor._id,
      clinicId: world.clinicA._id,
      slotStart: nextSlot(-5),
      status: AppointmentStatus.COMPLETED,
    });

    const response = await as(colleagueToken)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        ...recordBody,
      })
      .expect(403);

    expect(response.body.code).toBe('NOT_TREATING_CLINICIAN');
  });

  it('refuses a record for a visit that has not happened', async () => {
    const world = await makeWorld();

    const pending = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
    });

    const response = await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: pending._id.toString(),
        type: 'consultation',
        ...recordBody,
      })
      .expect(409);

    expect(response.body.message).toMatch(/complete the appointment/i);
  });

  it('rejects a future visit date', async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        visitDate: nextSlot(10).toISOString(),
        ...recordBody,
      })
      .expect(400);
  });

  /* A weight taken at a visit is the most current one we have. */
  it('propagates a recorded weight to the pet', async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        ...recordBody,
        vitals: { weightKg: 31.2 },
      })
      .expect(201);

    const pet = await as(world.tokens.clientA)
      .get(`${API}/pets/${world.petA._id.toString()}`)
      .expect(200);

    expect(pet.body.data.weightKg).toBe(31.2);
  });
});

describe('the medical record amendment trail', () => {
  async function recordFor() {
    const { world, appointment } = await completedVisit();

    const created = await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        ...recordBody,
      })
      .expect(201);

    return { world, recordId: created.body.data.id as string };
  }

  it('lets the author edit freely inside the window, with no amendment', async () => {
    const { world, recordId } = await recordFor();

    const response = await as(world.tokens.doctorA)
      .patch(`${API}/medical/records/${recordId}`)
      .send({ diagnosis: 'Mild cranial cruciate ligament strain, grade 1.' })
      .expect(200);

    expect(response.body.data.amendments).toHaveLength(0);
    expect(response.body.data.diagnosis).toMatch(/grade 1/);
  });

  it('refuses a colleague editing the note', async () => {
    const { world, recordId } = await recordFor();
    const colleague = await makeDoctor(world.clinicA._id);
    const colleagueToken = await authFor(colleague.user);

    const response = await as(colleagueToken)
      .patch(`${API}/medical/records/${recordId}`)
      .send({ diagnosis: 'Rewritten by somebody else' })
      .expect(403);

    expect(response.body.code).toBe('NOT_TREATING_CLINICIAN');
  });

  it('locks on sign-off and then demands a reason', async () => {
    const { world, recordId } = await recordFor();

    const locked = await as(world.tokens.doctorA)
      .post(`${API}/medical/records/${recordId}/lock`)
      .expect(200);

    expect(locked.body.data.isEditable).toBe(false);

    const refused = await as(world.tokens.doctorA)
      .patch(`${API}/medical/records/${recordId}`)
      .send({ diagnosis: 'Changed after sign-off' })
      .expect(400);

    expect(refused.body.code).toBe('AMENDMENT_REASON_REQUIRED');
  });

  /**
   * The amendment preserves the prior text.
   *
   * This is the whole point of the trail — a clinical history that can be
   * silently rewritten is worth less than no history at all.
   */
  it('preserves the previous values when amending a locked record', async () => {
    const { world, recordId } = await recordFor();

    await as(world.tokens.doctorA).post(`${API}/medical/records/${recordId}/lock`).expect(200);

    const response = await as(world.tokens.doctorA)
      .patch(`${API}/medical/records/${recordId}`)
      .send({
        diagnosis: 'Cranial cruciate ligament rupture, confirmed on imaging.',
        amendmentReason: 'Radiography returned after the initial write-up.',
      })
      .expect(200);

    expect(response.body.data.amendments).toHaveLength(1);
    expect(response.body.data.amendments[0].previousValues.diagnosis).toBe(recordBody.diagnosis);
    expect(response.body.data.amendments[0].reason).toMatch(/Radiography/);
    expect(response.body.data.diagnosis).toMatch(/rupture/);
  });

  /* There is no unlock route — the value of the lock is that the person it
     constrains cannot undo it. */
  it('exposes no route to unlock a record', async () => {
    const { world, recordId } = await recordFor();

    await as(world.tokens.doctorA).post(`${API}/medical/records/${recordId}/lock`).expect(200);
    await as(world.tokens.doctorA).post(`${API}/medical/records/${recordId}/unlock`).expect(404);
  });

  it('never exposes a hard delete', async () => {
    const { world, recordId } = await recordFor();

    await as(world.tokens.doctorA).delete(`${API}/medical/records/${recordId}`).expect(404);
    await expect(MedicalRecord.countDocuments({ _id: recordId })).resolves.toBe(1);
  });
});

describe('medical record visibility', () => {
  it('lets the owner read their pet’s record but not a stranger', async () => {
    const { world, appointment } = await completedVisit();

    const created = await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        ...recordBody,
      })
      .expect(201);

    const recordId = created.body.data.id as string;

    await as(world.tokens.clientA).get(`${API}/medical/records/${recordId}`).expect(200);
    await as(world.tokens.clientB).get(`${API}/medical/records/${recordId}`).expect(404);
  });

  /* Admins read clinical history for continuity of care and disputes. */
  it('lets an admin read clinical records in their clinic', async () => {
    const { world, appointment } = await completedVisit();

    const created = await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        ...recordBody,
      })
      .expect(201);

    await as(world.tokens.adminA)
      .get(`${API}/medical/records/${created.body.data.id}`)
      .expect(200);

    await as(world.tokens.adminB)
      .get(`${API}/medical/records/${created.body.data.id}`)
      .expect(404);
  });

  it('shows a client only their own pets’ records in a list', async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.doctorA)
      .post(`${API}/medical/records`)
      .send({
        petId: world.petA._id.toString(),
        appointmentId: appointment._id.toString(),
        type: 'consultation',
        ...recordBody,
      })
      .expect(201);

    const mine = await as(world.tokens.clientA).get(`${API}/medical/records`).expect(200);
    const theirs = await as(world.tokens.clientB).get(`${API}/medical/records`).expect(200);

    expect(mine.body.data.items).toHaveLength(1);
    expect(theirs.body.data.items).toHaveLength(0);
  });
});

describe('vaccinations', () => {
  it('lets a clinician record a dose', async () => {
    const { world } = await completedVisit();

    await as(world.tokens.doctorA)
      .post(`${API}/medical/vaccinations`)
      .send({
        petId: world.petA._id.toString(),
        vaccineName: 'Leptospirosis',
        doseNumber: 1,
        totalDoses: 2,
        dueAt: nextSlot(30).toISOString(),
      })
      .expect(201);
  });

  /* One row per dose, so a double submit would otherwise show the owner a
     duplicate on their pet's vaccination card. */
  it('refuses the same dose of the same vaccine twice', async () => {
    const { world } = await completedVisit();

    const payload = {
      petId: world.petA._id.toString(),
      vaccineName: 'Leptospirosis',
      doseNumber: 1,
      dueAt: nextSlot(30).toISOString(),
    };

    await as(world.tokens.doctorA).post(`${API}/medical/vaccinations`).send(payload).expect(201);
    await as(world.tokens.doctorA).post(`${API}/medical/vaccinations`).send(payload).expect(409);
  });

  it('refuses a client recording a dose', async () => {
    const { world } = await completedVisit();

    await as(world.tokens.clientA)
      .post(`${API}/medical/vaccinations`)
      .send({
        petId: world.petA._id.toString(),
        vaccineName: 'Rabies',
        dueAt: nextSlot(30).toISOString(),
      })
      .expect(403);
  });

  it('serves a client their own vaccination schedule', async () => {
    const { world } = await completedVisit();

    await as(world.tokens.doctorA)
      .post(`${API}/medical/vaccinations`)
      .send({
        petId: world.petA._id.toString(),
        vaccineName: 'Rabies',
        dueAt: nextSlot(10).toISOString(),
      })
      .expect(201);

    const response = await as(world.tokens.clientA)
      .get(`${API}/medical/vaccinations/schedule`)
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].vaccineName).toBe('Rabies');
    expect(response.body.data[0].isOverdue).toBe(false);
  });
});

describe('reviews', () => {
  const reviewBody = {
    rating: 5,
    title: 'Excellent with an anxious dog',
    comment: 'Took the time to let him settle before examining. Explained everything clearly.',
  };

  it('lets the attending client review a completed visit', async () => {
    const { world, appointment } = await completedVisit();

    const response = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(201);

    expect(response.body.data.rating).toBe(5);
    expect(response.body.data.isVerified).toBe(true);
  });

  /**
   * One review per visit, enforced by a unique index.
   *
   * An application-level "have they already?" check would let two concurrent
   * submits both pass.
   */
  it('refuses a second review of the same visit', async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(201);

    const response = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), rating: 1, comment: 'Changed my mind entirely.' })
      .expect(409);

    expect(response.body.code).toBe('REVIEW_ALREADY_EXISTS');
  });

  it('refuses a review of a visit that has not completed', async () => {
    const world = await makeWorld();

    const pending = await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
    });

    const response = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: pending._id.toString(), ...reviewBody })
      .expect(400);

    expect(response.body.code).toBe('REVIEW_REQUIRES_COMPLETED_VISIT');
  });

  it("refuses a review of somebody else's visit", async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.clientB)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(404);
  });

  it('refuses a review once the window has closed', async () => {
    const { world, appointment } = await completedVisit();

    await Appointment.updateOne(
      { _id: appointment._id },
      {
        $set: {
          completedAt: new Date(Date.now() - (REVIEWS.WINDOW_DAYS + 5) * 86_400_000),
        },
      },
    );

    const response = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(403);

    expect(response.body.code).toBe('REVIEW_WINDOW_PASSED');
  });

  /**
   * The rating aggregate is maintained incrementally, so it must move on every
   * write. A recompute-on-read would hide a bug here.
   */
  it('increments the doctor’s running aggregate', async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), rating: 4, comment: 'Solid, helpful consultation.' })
      .expect(201);

    const doctor = await Doctor.findById(world.doctorA.doctor._id).lean();
    expect(doctor?.ratingCount).toBe(1);
    expect(doctor?.ratingSum).toBe(4);
    expect(doctor?.ratingAverage).toBe(4);
    expect(doctor?.ratingDistribution[4]).toBe(1);
  });

  /* Moderation must move the average, or hiding a review silently rewrites a
     doctor's score without changing it. */
  it('removes a hidden review from the average and restores it', async () => {
    const { world, appointment } = await completedVisit();

    const created = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), rating: 5, comment: 'A genuinely excellent visit.' })
      .expect(201);

    const reviewId = created.body.data.id as string;

    await as(world.tokens.adminA)
      .patch(`${API}/reviews/${reviewId}/moderate`)
      .send({ status: 'hidden', note: 'Testing moderation' })
      .expect(200);

    let doctor = await Doctor.findById(world.doctorA.doctor._id).lean();
    expect(doctor?.ratingCount).toBe(0);
    expect(doctor?.ratingAverage).toBe(0);

    await as(world.tokens.adminA)
      .patch(`${API}/reviews/${reviewId}/moderate`)
      .send({ status: 'published' })
      .expect(200);

    doctor = await Doctor.findById(world.doctorA.doctor._id).lean();
    expect(doctor?.ratingCount).toBe(1);
    expect(doctor?.ratingAverage).toBe(5);
  });

  it('refuses moderation by a client', async () => {
    const { world, appointment } = await completedVisit();

    const created = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(201);

    await as(world.tokens.clientB)
      .patch(`${API}/reviews/${created.body.data.id}/moderate`)
      .send({ status: 'hidden' })
      .expect(403);
  });

  it('lets only the reviewed doctor reply', async () => {
    const { world, appointment } = await completedVisit();

    const created = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(201);

    const reviewId = created.body.data.id as string;

    await as(world.tokens.doctorB)
      .post(`${API}/reviews/${reviewId}/respond`)
      .send({ comment: 'Replying to a review that is not mine at all.' })
      .expect(403);

    await as(world.tokens.doctorA)
      .post(`${API}/reviews/${reviewId}/respond`)
      .send({ comment: 'Thank you — glad he settled so well with us.' })
      .expect(200);
  });

  /**
   * Anonymity is applied at serialisation, so the author still recognises their
   * own review while nobody else sees their name.
   */
  it('hides an anonymous author from others but not from themselves', async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody, isAnonymous: true })
      .expect(201);

    const publicView = await anon()
      .get(`${API}/reviews?doctorId=${world.doctorA.doctor._id.toString()}`)
      .expect(200);

    expect(publicView.body.data.items[0].clientName).toBe('Anonymous');
    expect(publicView.body.data.items[0].clientAvatar).toBeUndefined();

    const ownView = await as(world.tokens.clientA)
      .get(`${API}/reviews?doctorId=${world.doctorA.doctor._id.toString()}`)
      .expect(200);

    expect(ownView.body.data.items[0].clientName).not.toBe('Anonymous');
    expect(ownView.body.data.items[0].isOwn).toBe(true);
  });

  it('serves a rating summary with a distribution and a response rate', async () => {
    const { world, appointment } = await completedVisit();

    await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(201);

    const response = await anon()
      .get(`${API}/reviews/summary/${world.doctorA.doctor._id.toString()}`)
      .expect(200);

    expect(response.body.data.average).toBe(5);
    expect(response.body.data.total).toBe(1);
    expect(Object.keys(response.body.data.distribution)).toHaveLength(5);
    /* One review against one completed visit. */
    expect(response.body.data.responseRate).toBe(1);
  });

  it('withdraws a review and removes it from the average', async () => {
    const { world, appointment } = await completedVisit();

    const created = await as(world.tokens.clientA)
      .post(`${API}/reviews`)
      .send({ appointmentId: appointment._id.toString(), ...reviewBody })
      .expect(201);

    await as(world.tokens.clientA)
      .delete(`${API}/reviews/${created.body.data.id}`)
      .expect(200);

    /* Withdrawn, not destroyed — the moderation history survives. */
    const stored = await Review.findById(created.body.data.id).lean();
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('removed');

    const doctor = await Doctor.findById(world.doctorA.doctor._id).lean();
    expect(doctor?.ratingCount).toBe(0);
  });
});

describe('free-edit window constant', () => {
  /* Documents the rule the amendment tests depend on, so a change to the
     constant shows up here rather than as a confusing failure elsewhere. */
  it('is a sane number of hours', () => {
    expect(MEDICAL.FREE_EDIT_WINDOW_HOURS).toBeGreaterThan(0);
    expect(MEDICAL.FREE_EDIT_WINDOW_HOURS).toBeLessThanOrEqual(72);
  });
});
