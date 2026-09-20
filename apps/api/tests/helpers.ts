/**
 * Test fixtures.
 *
 * Builds a realistic tenancy — two clinics, staff in each, clients with pets —
 * because most of the interesting bugs in this codebase are *scope* bugs, and
 * you cannot catch a cross-tenant leak with only one tenant in the database.
 *
 * Passwords are hashed once and reused. scrypt is deliberately slow, so hashing
 * per fixture would add several seconds to every suite.
 */

import type { Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import {
  AppointmentStatus,
  AppointmentType,
  PetSpecies,
  Role,
  UserStatus,
  type DayOfWeek,
} from '@pawsitive/shared';
import { createApp } from '../src/app.js';
import {
  Appointment,
  Clinic,
  Doctor,
  Pet,
  User,
} from '../src/models/index.js';
import { hashPassword } from '../src/utils/crypto.js';
import { issueAccessToken, issueRefreshToken } from '../src/services/token.service.js';

export const TEST_PASSWORD = 'CorrectHorse9!Battery';

let cachedHash: string | null = null;

async function passwordHash(): Promise<string> {
  cachedHash ??= await hashPassword(TEST_PASSWORD);
  return cachedHash;
}

let cachedApp: Express | null = null;

export function app(): Express {
  cachedApp ??= createApp();
  return cachedApp;
}

/** The prefix every route is mounted under. */
export const API = '/api/v1';

/* -------------------------------------------------------------------------- */
/*                                  Factories                                 */
/* -------------------------------------------------------------------------- */

export async function makeClinic(name = 'Test Clinic') {
  return Clinic.create({
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '-')}@test.local`,
    phone: '+919876500000',
    address: {
      line1: '1 Test Road',
      city: 'Hyderabad',
      state: 'Telangana',
      postalCode: '500001',
      country: 'India',
    },
    timezone: 'Asia/Kolkata',
    currency: 'INR',
  });
}

export interface MakeUserOptions {
  role?: Role;
  clinicId?: Types.ObjectId | null;
  email?: string;
  status?: UserStatus;
  firstName?: string;
  lastName?: string;
}

let userCounter = 0;

export async function makeUser(options: MakeUserOptions = {}) {
  userCounter += 1;

  return User.create({
    firstName: options.firstName ?? 'Test',
    lastName: options.lastName ?? 'User',
    email: options.email ?? `user-${userCounter}-${Date.now()}@test.local`,
    passwordHash: await passwordHash(),
    role: options.role ?? Role.CLIENT,
    clinic: options.clinicId ?? null,
    status: options.status ?? UserStatus.ACTIVE,
    emailVerified: true,
  });
}

/**
 * A doctor is a User plus a Doctor profile, and almost nothing works with only
 * one of them — so the factory always creates both.
 */
export async function makeDoctor(
  clinicId: Types.ObjectId,
  options: {
    email?: string;
    slotMinutes?: 10 | 15 | 20 | 30 | 60;
    /** Defaults to every day, so tests do not depend on what weekday it is. */
    weekly?: { dayOfWeek: DayOfWeek; blocks: { start: string; end: string }[] }[];
    minimumNoticeMinutes?: number;
    isAcceptingPatients?: boolean;
    feeMinor?: number;
  } = {},
) {
  const user = await makeUser({
    role: Role.DOCTOR,
    clinicId,
    ...(options.email ? { email: options.email } : {}),
    firstName: 'Doc',
    lastName: 'Tor',
  });

  /* Open every day by default. A weekday-restricted default would make tests
     pass or fail depending on the day they run — the exact bug the seed had. */
  const allDays = ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map((dayOfWeek) => ({
    dayOfWeek,
    blocks: [{ start: '09:00', end: '17:00' }],
  }));

  const doctor = await Doctor.create({
    user: user._id,
    clinic: clinicId,
    title: 'Veterinarian',
    bio: 'Test doctor',
    specializations: ['General Practice'],
    licenseNumber: `VET-${Date.now()}-${userCounter}`,
    yearsOfExperience: 5,
    consultationFeeMinor: options.feeMinor ?? 50_000,
    currency: 'INR',
    isAcceptingPatients: options.isAcceptingPatients ?? true,
    availability: {
      timezone: 'Asia/Kolkata',
      slotDurationMinutes: options.slotMinutes ?? 30,
      bufferMinutes: 0,
      advanceBookingDays: 60,
      /* Zero notice by default so a test can book the next available slot
         without waiting an hour. */
      minimumNoticeMinutes: options.minimumNoticeMinutes ?? 0,
      weekly: options.weekly ?? allDays,
      overrides: [],
    },
  });

  return { user, doctor };
}

export async function makePet(ownerId: Types.ObjectId, name = 'Rex') {
  return Pet.create({
    owner: ownerId,
    name,
    species: PetSpecies.DOG,
    breed: 'Labrador',
    sex: 'male',
    dateOfBirth: new Date('2022-06-15'),
  });
}

export async function makeAppointment(options: {
  clientId: Types.ObjectId;
  petId: Types.ObjectId;
  doctorId: Types.ObjectId;
  clinicId: Types.ObjectId;
  slotStart?: Date;
  status?: AppointmentStatus;
}) {
  const slotStart = options.slotStart ?? nextSlot(7);

  return Appointment.create({
    client: options.clientId,
    pet: options.petId,
    doctor: options.doctorId,
    clinic: options.clinicId,
    slotStart,
    durationMinutes: 30,
    type: AppointmentType.CONSULTATION,
    reason: 'Test consultation',
    status: options.status ?? AppointmentStatus.PENDING,
    feeAmountMinor: 50_000,
    feeCurrency: 'INR',
    createdBy: options.clientId,
    ...(options.status === AppointmentStatus.COMPLETED
      ? { confirmedAt: slotStart, startedAt: slotStart, completedAt: slotStart }
      : {}),
  });
}

/* -------------------------------------------------------------------------- */
/*                                Authentication                              */
/* -------------------------------------------------------------------------- */

/**
 * Mint a real session for a user.
 *
 * Issues a genuine refresh-token row as well as the JWT, because
 * `authenticate` checks the session is live on every request — a hand-rolled
 * token with no backing session would be rejected, which is correct behaviour
 * and would make every authenticated test fail for the wrong reason.
 */
export async function authFor(user: {
  _id: Types.ObjectId;
  role: Role;
  clinic?: Types.ObjectId | null;
}): Promise<string> {
  const refresh = await issueRefreshToken({ userId: user._id });

  const { token } = issueAccessToken({
    userId: user._id,
    role: user.role,
    clinicId: user.clinic ?? null,
    sessionId: refresh.sessionId,
  });

  return token;
}

/** `request(app()).get(...)` with the bearer header already attached. */
export function as(token: string) {
  const agent = request(app());

  return {
    get: (path: string) => agent.get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string) => agent.post(path).set('Authorization', `Bearer ${token}`),
    patch: (path: string) => agent.patch(path).set('Authorization', `Bearer ${token}`),
    put: (path: string) => agent.put(path).set('Authorization', `Bearer ${token}`),
    delete: (path: string) => agent.delete(path).set('Authorization', `Bearer ${token}`),
  };
}

export function anon() {
  return request(app());
}

/* -------------------------------------------------------------------------- */
/*                                  Utilities                                 */
/* -------------------------------------------------------------------------- */

/**
 * A slot start `daysAhead` from now, snapped to 10:00 UTC.
 *
 * Fixed at a time that is inside the default 09:00–17:00 Asia/Kolkata window
 * (which is 03:30–11:30 UTC), so it is always a valid grid position regardless
 * of when the test runs.
 */
export function nextSlot(daysAhead = 7, hourUtc = 5, minuteUtc = 30): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return date;
}

/** `YYYY-MM-DD` for a date `daysAhead` from today. */
export function dateOnly(daysAhead = 0): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

/**
 * A complete two-clinic world.
 *
 * Most suites want this: without a second clinic there is no way to assert that
 * scoping actually excludes anything.
 */
export async function makeWorld() {
  const [clinicA, clinicB] = await Promise.all([
    makeClinic('Clinic Alpha'),
    makeClinic('Clinic Beta'),
  ]);

  const [superAdmin, adminA, adminB, clientA, clientB] = await Promise.all([
    makeUser({ role: Role.SUPER_ADMIN, firstName: 'Sue', lastName: 'Peradmin' }),
    makeUser({ role: Role.ADMIN, clinicId: clinicA._id, firstName: 'Ada', lastName: 'Minalpha' }),
    makeUser({ role: Role.ADMIN, clinicId: clinicB._id, firstName: 'Bob', lastName: 'Minbeta' }),
    makeUser({ role: Role.CLIENT, firstName: 'Cleo', lastName: 'Alpha' }),
    makeUser({ role: Role.CLIENT, firstName: 'Cass', lastName: 'Beta' }),
  ]);

  const [doctorA, doctorB] = await Promise.all([
    makeDoctor(clinicA._id),
    makeDoctor(clinicB._id),
  ]);

  const [petA, petB] = await Promise.all([
    makePet(clientA._id, 'Alphapet'),
    makePet(clientB._id, 'Betapet'),
  ]);

  const tokens = {
    superAdmin: await authFor(superAdmin),
    adminA: await authFor(adminA),
    adminB: await authFor(adminB),
    doctorA: await authFor(doctorA.user),
    doctorB: await authFor(doctorB.user),
    clientA: await authFor(clientA),
    clientB: await authFor(clientB),
  };

  return {
    clinicA,
    clinicB,
    superAdmin,
    adminA,
    adminB,
    clientA,
    clientB,
    doctorA,
    doctorB,
    petA,
    petB,
    tokens,
  };
}
