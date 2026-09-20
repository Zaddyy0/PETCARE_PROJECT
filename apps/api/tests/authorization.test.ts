/**
 * Authorization and data scoping.
 *
 * These are the tests that matter most in a multi-tenant product, because a
 * scoping bug produces **no error** — just a response containing rows the
 * caller should never have seen. There is nothing to notice in development
 * where only one clinic exists, which is why every case here runs against two.
 *
 * Structure mirrors the two-layer model: capability (can this role ever?) and
 * ownership (can this user, to this row?).
 */

import { describe, expect, it } from 'vitest';
import {
  AppointmentStatus,
  ROLE_PERMISSIONS,
  Role,
  canActOnRole,
  roleHasPermission,
} from '@pawsitive/shared';
import { API, anon, as, makeAppointment, makePet, makeWorld } from './helpers.js';

/* -------------------------------------------------------------------------- */
/*                        Layer 1 — the permission matrix                     */
/* -------------------------------------------------------------------------- */

describe('the permission matrix', () => {
  it('gives clients no clinical write access', () => {
    expect(roleHasPermission(Role.CLIENT, 'medical_record:write')).toBe(false);
    expect(roleHasPermission(Role.CLIENT, 'vaccination:write')).toBe(false);
  });

  /**
   * Clinical authorship is restricted to clinicians — admins may read but not
   * write. This is a deliberate product decision, recorded as a test so it
   * cannot be reversed by accident while adding a permission.
   */
  it('gives admins clinical read but not clinical write', () => {
    expect(roleHasPermission(Role.ADMIN, 'medical_record:read:clinic')).toBe(true);
    expect(roleHasPermission(Role.ADMIN, 'medical_record:write')).toBe(false);
  });

  it('gives doctors clinical write', () => {
    expect(roleHasPermission(Role.DOCTOR, 'medical_record:write')).toBe(true);
  });

  it('restricts impersonation to super admins', () => {
    expect(roleHasPermission(Role.SUPER_ADMIN, 'user:impersonate')).toBe(true);
    expect(roleHasPermission(Role.ADMIN, 'user:impersonate')).toBe(false);
    expect(roleHasPermission(Role.DOCTOR, 'user:impersonate')).toBe(false);
    expect(roleHasPermission(Role.CLIENT, 'user:impersonate')).toBe(false);
  });

  it('restricts role changes to super admins', () => {
    expect(roleHasPermission(Role.SUPER_ADMIN, 'user:change_role')).toBe(true);
    expect(roleHasPermission(Role.ADMIN, 'user:change_role')).toBe(false);
  });

  it('gives a doctor no pet-ownership capabilities', () => {
    /* A doctor is not a pet owner in this system — they reach pets through
       care, not ownership. */
    expect(roleHasPermission(Role.DOCTOR, 'pet:create')).toBe(false);
    expect(roleHasPermission(Role.DOCTOR, 'pet:delete:own')).toBe(false);
  });

  it('gives a super admin every permission', () => {
    /* Constructed from the full list rather than maintained by hand, so this
       asserts the construction rather than a copy of it. */
    for (const permission of ROLE_PERMISSIONS[Role.CLIENT]) {
      expect(roleHasPermission(Role.SUPER_ADMIN, permission)).toBe(true);
    }
    for (const permission of ROLE_PERMISSIONS[Role.ADMIN]) {
      expect(roleHasPermission(Role.SUPER_ADMIN, permission)).toBe(true);
    }
  });

  /**
   * Strictly-greater rank, so peers cannot act on each other. Without this,
   * "admins can manage users" quietly includes "admins can suspend each other".
   */
  it('stops peers acting on one another', () => {
    expect(canActOnRole(Role.ADMIN, Role.ADMIN)).toBe(false);
    expect(canActOnRole(Role.ADMIN, Role.SUPER_ADMIN)).toBe(false);
    expect(canActOnRole(Role.DOCTOR, Role.DOCTOR)).toBe(false);
    expect(canActOnRole(Role.ADMIN, Role.CLIENT)).toBe(true);
    expect(canActOnRole(Role.ADMIN, Role.DOCTOR)).toBe(true);
  });

  /* The one exception: a super admin outranks their peers, or the last one
     could never be demoted by anybody. */
  it('lets a super admin act on a peer', () => {
    expect(canActOnRole(Role.SUPER_ADMIN, Role.SUPER_ADMIN)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/*                       Layer 2 — ownership and tenancy                      */
/* -------------------------------------------------------------------------- */

describe('pet scoping', () => {
  it('shows a client only their own pets', async () => {
    const world = await makeWorld();
    await makePet(world.clientA._id, 'Second Alphapet');

    const response = await as(world.tokens.clientA).get(`${API}/pets`).expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(
      response.body.data.items.every(
        (pet: { ownerId: string }) => pet.ownerId === world.clientA._id.toString(),
      ),
    ).toBe(true);
  });

  /* 404, not 403 — a 403 confirms the id exists, which is itself a leak. */
  it("returns 404 for another client's pet", async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.clientA)
      .get(`${API}/pets/${world.petB._id.toString()}`)
      .expect(404);

    expect(response.body.code).toBe('PET_NOT_FOUND');
  });

  it("refuses to update another client's pet", async () => {
    const world = await makeWorld();

    await as(world.tokens.clientA)
      .patch(`${API}/pets/${world.petB._id.toString()}`)
      .send({ name: 'Renamed by a stranger' })
      .expect(404);
  });

  /**
   * Mass assignment.
   *
   * A client supplying `ownerId` must not create a pet for somebody else, and
   * fields outside the schema must be stripped rather than written.
   */
  it('ignores ownerId and unknown fields from a client', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.clientA)
      .post(`${API}/pets`)
      .send({
        name: 'Trojan',
        species: 'dog',
        sex: 'male',
        ownerId: world.clientB._id.toString(),
        status: 'archived',
      })
      .expect(201);

    expect(response.body.data.ownerId).toBe(world.clientA._id.toString());
    expect(response.body.data.status).toBe('active');
  });

  /**
   * A doctor reaches a pet through *care*, not through the pet record.
   *
   * Before any appointment exists there is no relationship, so the pet is not
   * visible — otherwise every clinician could read every pet on the platform.
   */
  it('hides a pet from a doctor with no care relationship', async () => {
    const world = await makeWorld();

    await as(world.tokens.doctorA)
      .get(`${API}/pets/${world.petA._id.toString()}`)
      .expect(404);
  });

  it('reveals a pet to a doctor once they have an appointment with it', async () => {
    const world = await makeWorld();

    await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
    });

    await as(world.tokens.doctorA)
      .get(`${API}/pets/${world.petA._id.toString()}`)
      .expect(200);
  });

  it("keeps a pet hidden from another clinic's doctor", async () => {
    const world = await makeWorld();

    await makeAppointment({
      clientId: world.clientA._id,
      petId: world.petA._id,
      doctorId: world.doctorA.doctor._id,
      clinicId: world.clinicA._id,
    });

    /* Clinic B's doctor has no relationship with this pet. */
    await as(world.tokens.doctorB)
      .get(`${API}/pets/${world.petA._id.toString()}`)
      .expect(404);
  });

  it('lets a super admin reach any pet', async () => {
    const world = await makeWorld();

    await as(world.tokens.superAdmin)
      .get(`${API}/pets/${world.petB._id.toString()}`)
      .expect(200);
  });
});

describe('appointment scoping', () => {
  async function worldWithAppointments() {
    const world = await makeWorld();

    const [apptA, apptB] = await Promise.all([
      makeAppointment({
        clientId: world.clientA._id,
        petId: world.petA._id,
        doctorId: world.doctorA.doctor._id,
        clinicId: world.clinicA._id,
      }),
      makeAppointment({
        clientId: world.clientB._id,
        petId: world.petB._id,
        doctorId: world.doctorB.doctor._id,
        clinicId: world.clinicB._id,
      }),
    ]);

    return { ...world, apptA, apptB };
  }

  it('shows a client only their own appointments', async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.clientA).get(`${API}/appointments`).expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(world.apptA._id.toString());
  });

  it('shows a doctor only their own appointments', async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.doctorA).get(`${API}/appointments`).expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].doctorId).toBe(world.doctorA.doctor._id.toString());
  });

  /**
   * A caller-supplied filter must never widen the scope.
   *
   * A doctor asking for a colleague's list gets their own — the parameter is
   * dropped, not honoured. Silently ignoring it is correct: a legitimate client
   * never sends it, so anything that does is a probe.
   */
  it("ignores a doctorId filter pointing at another doctor", async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.doctorA)
      .get(`${API}/appointments?doctorId=${world.doctorB.doctor._id.toString()}`)
      .expect(200);

    expect(
      response.body.data.items.every(
        (appointment: { doctorId: string }) =>
          appointment.doctorId === world.doctorA.doctor._id.toString(),
      ),
    ).toBe(true);
  });

  it("ignores a clientId filter from a client", async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.clientA)
      .get(`${API}/appointments?clientId=${world.clientB._id.toString()}`)
      .expect(200);

    expect(
      response.body.data.items.every(
        (appointment: { clientId: string }) =>
          appointment.clientId === world.clientA._id.toString(),
      ),
    ).toBe(true);
  });

  it('shows an admin their whole clinic but not another clinic', async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.adminA).get(`${API}/appointments`).expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].clinicId).toBe(world.clinicA._id.toString());
  });

  it("returns 404 when an admin reaches into another clinic", async () => {
    const world = await worldWithAppointments();

    await as(world.tokens.adminA)
      .get(`${API}/appointments/${world.apptB._id.toString()}`)
      .expect(404);
  });

  it('shows a super admin everything', async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.superAdmin).get(`${API}/appointments`).expect(200);

    expect(response.body.data.items).toHaveLength(2);
  });

  /**
   * `allowedTransitions` is computed per viewer.
   *
   * The UI renders exactly these as buttons, so a mismatch here means offering
   * a user an action the server will reject.
   */
  it('offers a client only cancellation', async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.clientA)
      .get(`${API}/appointments/${world.apptA._id.toString()}`)
      .expect(200);

    expect(response.body.data.allowedTransitions).toEqual(['cancelled']);
  });

  it('offers a doctor the clinical transitions', async () => {
    const world = await worldWithAppointments();

    const response = await as(world.tokens.doctorA)
      .get(`${API}/appointments/${world.apptA._id.toString()}`)
      .expect(200);

    expect(response.body.data.allowedTransitions).toContain('confirmed');
    expect(response.body.data.allowedTransitions).toContain('cancelled');
  });

  it('refuses to let a client confirm their own booking', async () => {
    const world = await worldWithAppointments();

    await as(world.tokens.clientA)
      .patch(`${API}/appointments/${world.apptA._id.toString()}/status`)
      .send({ status: AppointmentStatus.CONFIRMED })
      .expect(403);
  });
});

describe('user administration scoping', () => {
  it('refuses a client the user list', async () => {
    const world = await makeWorld();
    await as(world.tokens.clientA).get(`${API}/users`).expect(403);
  });

  it('refuses a doctor the user list', async () => {
    const world = await makeWorld();
    await as(world.tokens.doctorA).get(`${API}/users`).expect(403);
  });

  it('never leaks a credential in the user list', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.adminA).get(`${API}/users`).expect(200);

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toMatch(/passwordHash/);
    expect(serialised).not.toMatch(/scrypt\$/);
    expect(serialised).not.toMatch(/failedLoginAttempts/);
  });

  /** Role changes are super-admin only, so an admin cannot promote themselves. */
  it('refuses an admin a role change', async () => {
    const world = await makeWorld();

    await as(world.tokens.adminA)
      .patch(`${API}/users/${world.clientA._id.toString()}/role`)
      .send({ role: Role.ADMIN, reason: 'Trying to promote a client' })
      .expect(403);
  });

  it('refuses an admin acting on a super admin', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.adminA)
      .post(`${API}/users/${world.superAdmin._id.toString()}/suspend`)
      .send({ reason: 'Trying to suspend a super admin' });

    /* 404 (out of visible scope) or 403 (outranked) are both correct refusals. */
    expect([403, 404]).toContain(response.status);
  });

  it("refuses an admin acting on another clinic's admin", async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.adminA)
      .post(`${API}/users/${world.adminB._id.toString()}/suspend`)
      .send({ reason: 'Trying to suspend a peer in another clinic' });

    expect([403, 404]).toContain(response.status);
  });

  /* Suspension must end live sessions, or it does not take effect until the
     victim's access token expires. */
  it('revokes sessions the moment an account is suspended', async () => {
    const world = await makeWorld();

    await as(world.tokens.clientA).get(`${API}/auth/me`).expect(200);

    const response = await as(world.tokens.adminA)
      .post(`${API}/users/${world.clientA._id.toString()}/suspend`)
      .send({ reason: 'Testing immediate revocation' })
      .expect(200);

    expect(response.body.data.revokedSessions).toBeGreaterThanOrEqual(1);

    const after = await as(world.tokens.clientA).get(`${API}/auth/me`);
    expect([401, 403]).toContain(after.status);
  });
});

describe('doctor management scoping', () => {
  it('refuses a client creating a doctor', async () => {
    const world = await makeWorld();

    await as(world.tokens.clientA)
      .post(`${API}/doctors`)
      .send({
        firstName: 'Fake',
        lastName: 'Doctor',
        email: 'fake@test.local',
        licenseNumber: 'X1',
      })
      .expect(403);
  });

  it('refuses a doctor creating a doctor', async () => {
    const world = await makeWorld();

    await as(world.tokens.doctorA)
      .post(`${API}/doctors`)
      .send({
        firstName: 'Fake',
        lastName: 'Doctor',
        email: 'fake2@test.local',
        licenseNumber: 'X2',
      })
      .expect(403);
  });

  /**
   * Licence details belong to the clinic's record of a clinician's credentials,
   * not to their editable profile.
   */
  it('refuses a doctor editing their own licence number', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.doctorA)
      .patch(`${API}/doctors/${world.doctorA.doctor._id.toString()}`)
      .send({ licenseNumber: 'SELF-ISSUED-999' })
      .expect(403);

    expect(response.body.code).toBe('INSUFFICIENT_PERMISSION');
  });

  it('lets a doctor edit their own bio', async () => {
    const world = await makeWorld();

    await as(world.tokens.doctorA)
      .patch(`${API}/doctors/${world.doctorA.doctor._id.toString()}`)
      .send({ bio: 'An updated biography for the public profile.' })
      .expect(200);
  });

  it("refuses a doctor editing another clinic's doctor", async () => {
    const world = await makeWorld();

    await as(world.tokens.doctorA)
      .patch(`${API}/doctors/${world.doctorB.doctor._id.toString()}`)
      .send({ bio: 'Editing a stranger' })
      .expect(403);
  });

  it("refuses an admin editing another clinic's doctor", async () => {
    const world = await makeWorld();

    await as(world.tokens.adminA)
      .patch(`${API}/doctors/${world.doctorB.doctor._id.toString()}`)
      .send({ bio: 'Cross-clinic edit' })
      .expect(403);
  });
});

describe('public endpoints', () => {
  it('serves the doctor directory anonymously', async () => {
    await makeWorld();
    const response = await anon().get(`${API}/doctors`).expect(200);
    expect(response.body.data.items.length).toBeGreaterThan(0);
  });

  /* A licence number is a regulated identifier with no place on a public page,
     and the raw availability rules are an implementation detail. */
  it('hides licence numbers and availability rules from the public projection', async () => {
    await makeWorld();

    const response = await anon().get(`${API}/doctors`).expect(200);

    for (const doctor of response.body.data.items) {
      expect(doctor.licenseNumber).toBeUndefined();
      expect(doctor.availability).toBeUndefined();
    }
  });

  it('requires a session for pets', async () => {
    await anon().get(`${API}/pets`).expect(401);
  });

  it('requires a session for appointments', async () => {
    await anon().get(`${API}/appointments`).expect(401);
  });
});

describe('analytics scope resolution', () => {
  it('gives each role its own dashboard shape', async () => {
    const world = await makeWorld();

    const [client, doctor, admin, superAdmin] = await Promise.all([
      as(world.tokens.clientA).get(`${API}/analytics/dashboard`).expect(200),
      as(world.tokens.doctorA).get(`${API}/analytics/dashboard`).expect(200),
      as(world.tokens.adminA).get(`${API}/analytics/dashboard`).expect(200),
      as(world.tokens.superAdmin).get(`${API}/analytics/dashboard`).expect(200),
    ]);

    expect(client.body.data.scope).toBe('client');
    expect(doctor.body.data.scope).toBe('doctor');
    expect(admin.body.data.scope).toBe('clinic');
    expect(superAdmin.body.data.scope).toBe('platform');
  });

  /**
   * The scope is derived server-side from permissions, so there is no parameter
   * a caller can set to widen it.
   */
  it('cannot be widened by a query parameter', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.clientA)
      .get(`${API}/analytics/dashboard?clinicId=${world.clinicA._id.toString()}`)
      .expect(200);

    expect(response.body.data.scope).toBe('client');
  });

  it('scopes an admin to their own clinic even when another is requested', async () => {
    const world = await makeWorld();

    const response = await as(world.tokens.adminA)
      .get(`${API}/analytics/dashboard?clinicId=${world.clinicB._id.toString()}`)
      .expect(200);

    expect(response.body.data.scope).toBe('clinic');
  });
});
