/**
 * Doctors, their availability, and the bookable slot grid.
 *
 * The slot logic is the reason this file matters. Availability is stored as
 * *rules* and expanded on demand by `generateSlots()` from the shared package —
 * the identical function the web client runs to paint its picker. That shared
 * implementation is what guarantees the times a user is offered and the times
 * the server will accept are the same set.
 */

import { Types } from 'mongoose';
import {
  BOOKING,
  ERROR_CODES,
  Role,
  SECURITY,
  SLOT_BLOCKING_STATUSES,
  UserStatus,
  addDaysToDateOnly,
  formatDateOnly,
  generateSlots,
  isValidSlotStart,
  type AvailableSlot,
  type CreateDoctorInput,
  type DoctorListQueryInput,
  type SlotQueryInput,
  type UpdateAvailabilityInput,
  type UpdateDoctorInput,
} from '@pawsitive/shared';
import { toAvailabilityDTO, toDoctorDTO, toPublicDoctorDTO } from '../dto/doctor.dto.js';
import { Appointment } from '../models/appointment.model.js';
import { Clinic } from '../models/clinic.model.js';
import { Doctor, type DoctorDocument } from '../models/doctor.model.js';
import { User, type UserDocument } from '../models/user.model.js';
import { ApiError } from '../utils/api-error.js';
import { generateSecureToken, hashPassword, hashToken } from '../utils/crypto.js';
import {
  buildPaginationMeta,
  buildSearchFilter,
  buildSort,
  resolvePage,
} from '../utils/pagination.js';
import type { AuthContext } from '../types/express.js';
import { assertCanActOnUser } from '../middleware/authorize.js';
import { inviteEmail, sendEmail } from './email.service.js';
import { toObjectId } from './scope.js';

/* -------------------------------------------------------------------------- */
/*                                  Directory                                 */
/* -------------------------------------------------------------------------- */

export async function listDoctors(auth: AuthContext | null, query: DoctorListQueryInput) {
  const { page, limit, skip } = resolvePage(query);

  const filter: Record<string, unknown> = { isActive: true };

  /* Staff see their own clinic by default; an anonymous or client caller sees
     the whole directory, since booking across clinics is allowed. */
  if (auth && auth.role !== Role.SUPER_ADMIN && auth.role !== Role.CLIENT && auth.clinicId) {
    filter['clinic'] = auth.clinicId;
  } else if (query.clinicId) {
    filter['clinic'] = toObjectId(query.clinicId, 'clinicId');
  }

  if (query.specialization) {
    filter['specializations'] = query.specialization;
  }

  if (query.minRating != null) {
    filter['ratingAverage'] = { $gte: query.minRating };
  }

  if (query.isAcceptingPatients != null) {
    filter['isAcceptingPatients'] = query.isAcceptingPatients;
  }

  const sortField = (
    {
      rating: 'ratingAverage',
      experience: 'yearsOfExperience',
      fee: 'consultationFeeMinor',
      name: 'createdAt',
    } as const
  )[query.sort ?? 'rating'];

  const sort = buildSort(
    sortField,
    query.order,
    ['ratingAverage', 'yearsOfExperience', 'consultationFeeMinor', 'createdAt'] as const,
    'ratingAverage',
  );

  /**
   * Name search lives on the User record, not the Doctor profile.
   *
   * So a name query resolves to user ids first, then constrains the doctor
   * query. Two round trips, but it keeps names in exactly one place — a
   * denormalised copy on the profile would go stale the moment someone
   * corrects a spelling.
   */
  if (query.search) {
    const nameFilter = buildSearchFilter(query.search, ['firstName', 'lastName', 'email']);
    if (nameFilter) {
      const matching = await User.find({ role: Role.DOCTOR, ...nameFilter })
        .select('_id')
        .limit(200)
        .lean();

      filter['user'] = { $in: matching.map((user) => user._id) };
    }
  }

  const [doctors, total] = await Promise.all([
    Doctor.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Doctor.countDocuments(filter),
  ]);

  const users = await loadDoctorUsers(doctors);

  const items = doctors.flatMap((doctor) => {
    const user = users.get(doctor.user.toString());
    /* A profile whose user was deleted is skipped rather than rendered with
       blanks — it is a data inconsistency, not something to show a client. */
    if (!user) return [];
    return [toPublicDoctorDTO(doctor, user)];
  });

  return { items, pagination: buildPaginationMeta(total, { page, limit }) };
}

async function loadDoctorUsers(doctors: { user: Types.ObjectId }[]) {
  const ids = [...new Set(doctors.map((doctor) => doctor.user.toString()))];
  if (ids.length === 0) return new Map<string, UserDocument>();

  const users = await User.find({ _id: { $in: ids } })
    .select('firstName lastName email avatar')
    .lean();

  return new Map(users.map((user) => [user._id.toString(), user as unknown as UserDocument]));
}

export async function getDoctor(auth: AuthContext | null, doctorId: string) {
  const { doctor, user } = await loadDoctorWithUser(doctorId);

  /* Staff and the doctor themselves get the full record, including licence and
     raw availability rules; everyone else gets the public projection. */
  const isPrivileged =
    auth != null &&
    (auth.role === Role.SUPER_ADMIN ||
      auth.doctorId?.toString() === doctor._id.toString() ||
      (auth.role === Role.ADMIN && auth.clinicId?.toString() === doctor.clinic.toString()));

  return isPrivileged ? toDoctorDTO(doctor, user) : toPublicDoctorDTO(doctor, user);
}

export async function loadDoctorWithUser(doctorId: string) {
  const id = toObjectId(doctorId, 'doctorId');
  const doctor = await Doctor.findById(id);

  if (!doctor || !doctor.isActive) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that doctor.');
  }

  const user = await User.findById(doctor.user);

  if (!user) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that doctor.');
  }

  return { doctor, user };
}

/* -------------------------------------------------------------------------- */
/*                                Availability                                */
/* -------------------------------------------------------------------------- */

/**
 * The bookable slot grid for a date range.
 *
 * Three inputs combine:
 *   1. the doctor's rules, expanded to a grid
 *   2. the appointments already occupying slots, subtracted
 *   3. the booking window (minimum notice, advance limit), clipped
 *
 * Note the deliberate choice to return *every* grid position with an
 * `isAvailable` flag, rather than only the free ones. A picker that strikes
 * through taken times reads far better than one where slots silently vanish,
 * and it tells the user the doctor is busy rather than closed.
 */
export async function getAvailableSlots(
  doctorId: string,
  query: SlotQueryInput,
): Promise<{ doctorId: string; timezone: string; slots: AvailableSlot[] }> {
  const id = toObjectId(doctorId, 'doctorId');
  const doctor = await Doctor.findById(id).lean();

  if (!doctor || !doctor.isActive) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that doctor.');
  }

  const availability = doctor.availability;
  const now = new Date();

  /* Clip the requested window to what is actually bookable, so a client asking
     for next year gets an empty list rather than slots it cannot book. */
  const notBefore = new Date(now.getTime() + availability.minimumNoticeMinutes * 60_000);
  const notAfter = new Date(now.getTime() + availability.advanceBookingDays * 86_400_000);

  const from = clampDate(query.from, formatDateOnly(now, availability.timezone));
  const to = clampDate(
    query.to,
    addDaysToDateOnly(formatDateOnly(now, availability.timezone), BOOKING.MAX_SLOT_QUERY_DAYS),
    'max',
  );

  /**
   * Which slots are taken.
   *
   * Scoped by `SLOT_BLOCKING_STATUSES` so a cancelled appointment's slot shows
   * as free — the same status list the unique index is derived from, imported
   * rather than restated so the two cannot drift.
   */
  const booked = await Appointment.find({
    doctor: id,
    status: { $in: [...SLOT_BLOCKING_STATUSES] },
    slotStart: {
      $gte: new Date(`${from}T00:00:00.000Z`),
      $lte: new Date(`${to}T23:59:59.999Z`),
    },
  })
    .select('slotStart')
    .lean();

  const bookedStartsMs = new Set(booked.map((appointment) => appointment.slotStart.getTime()));

  const slots = generateSlots({
    from,
    to,
    timeZone: availability.timezone,
    slotDurationMinutes: availability.slotDurationMinutes,
    bufferMinutes: availability.bufferMinutes,
    weekly: availability.weekly,
    overrides: availability.overrides,
    bookedStartsMs,
    notBefore,
    notAfter,
  });

  /* A doctor who has closed their books shows their calendar but nothing
     bookable — clearer than an empty grid that looks like a bug. */
  const acceptingPatients = doctor.isAcceptingPatients;

  return {
    doctorId: id.toString(),
    timezone: availability.timezone,
    slots: slots.map((slot) => ({
      start: slot.start.toISOString(),
      end: slot.end.toISOString(),
      isAvailable: acceptingPatients && slot.isAvailable,
    })),
  };
}

function clampDate(value: string, boundary: string, mode: 'min' | 'max' = 'min'): string {
  if (mode === 'min') return value < boundary ? boundary : value;
  return value > boundary ? boundary : value;
}

/**
 * Confirm a requested start is a real position on this doctor's grid.
 *
 * Called by the booking service before any write. This is what rejects a
 * crafted `09:07`, a 3am slot on a day the doctor does not work, or a time
 * outside the notice window — none of which the unique index would catch,
 * because they are all *distinct* keys and would insert happily.
 */
export async function assertSlotIsBookable(
  doctor: { availability: DoctorDocument['availability']; isAcceptingPatients: boolean },
  slotStart: Date,
  now: Date = new Date(),
): Promise<void> {
  if (!doctor.isAcceptingPatients) {
    throw ApiError.conflict(ERROR_CODES.DOCTOR_NOT_ACCEPTING_PATIENTS);
  }

  const availability = doctor.availability;

  if (slotStart.getTime() <= now.getTime()) {
    throw ApiError.badRequest(ERROR_CODES.APPOINTMENT_SLOT_PAST);
  }

  const noticeMs = availability.minimumNoticeMinutes * 60_000;
  if (slotStart.getTime() < now.getTime() + noticeMs) {
    throw ApiError.badRequest(
      ERROR_CODES.APPOINTMENT_TOO_SOON,
      `This doctor needs at least ${availability.minimumNoticeMinutes} minutes' notice.`,
    );
  }

  const horizonMs = availability.advanceBookingDays * 86_400_000;
  if (slotStart.getTime() > now.getTime() + horizonMs) {
    throw ApiError.badRequest(
      ERROR_CODES.APPOINTMENT_TOO_FAR,
      `Bookings open ${availability.advanceBookingDays} days ahead.`,
    );
  }

  const valid = isValidSlotStart(slotStart, {
    timeZone: availability.timezone,
    slotDurationMinutes: availability.slotDurationMinutes,
    bufferMinutes: availability.bufferMinutes,
    weekly: availability.weekly,
    overrides: availability.overrides,
  });

  if (!valid) {
    throw ApiError.badRequest(
      ERROR_CODES.APPOINTMENT_DOCTOR_UNAVAILABLE,
      'The doctor is not available at that time.',
    );
  }
}

export async function updateAvailability(
  auth: AuthContext,
  doctorId: string,
  input: UpdateAvailabilityInput,
) {
  const doctor = await loadDoctorForWrite(auth, doctorId);

  if (input.timezone !== undefined) doctor.availability.timezone = input.timezone;
  if (input.slotDurationMinutes !== undefined) {
    doctor.availability.slotDurationMinutes = input.slotDurationMinutes;
  }
  if (input.bufferMinutes !== undefined) doctor.availability.bufferMinutes = input.bufferMinutes;
  if (input.advanceBookingDays !== undefined) {
    doctor.availability.advanceBookingDays = input.advanceBookingDays;
  }
  if (input.minimumNoticeMinutes !== undefined) {
    doctor.availability.minimumNoticeMinutes = input.minimumNoticeMinutes;
  }
  if (input.weekly !== undefined) doctor.availability.weekly = input.weekly;
  if (input.overrides !== undefined) doctor.availability.overrides = input.overrides;

  await doctor.save();

  /**
   * Changing hours does not cancel existing appointments.
   *
   * A doctor narrowing their Tuesday hours may already have Tuesday bookings,
   * and silently cancelling a client's confirmed visit because a rule changed
   * would be far worse than an appointment sitting slightly outside the
   * published grid. Those bookings stand; the clinic can move them explicitly.
   * We report the count so the UI can say so.
   */
  const outsideHours = await countAppointmentsOutsideAvailability(doctor);

  return {
    availability: toAvailabilityDTO(doctor.availability),
    appointmentsOutsideNewHours: outsideHours,
  };
}

async function countAppointmentsOutsideAvailability(doctor: DoctorDocument): Promise<number> {
  const now = new Date();

  const upcoming = await Appointment.find({
    doctor: doctor._id,
    status: { $in: [...SLOT_BLOCKING_STATUSES] },
    slotStart: { $gte: now },
  })
    .select('slotStart')
    .limit(500)
    .lean();

  const availability = doctor.availability;

  return upcoming.filter(
    (appointment) =>
      !isValidSlotStart(appointment.slotStart, {
        timeZone: availability.timezone,
        slotDurationMinutes: availability.slotDurationMinutes,
        bufferMinutes: availability.bufferMinutes,
        weekly: availability.weekly,
        overrides: availability.overrides,
      }),
  ).length;
}

/* -------------------------------------------------------------------------- */
/*                              Create & update                               */
/* -------------------------------------------------------------------------- */

/**
 * Create a doctor: a User account plus a Doctor profile.
 *
 * Two documents in two collections. If the profile write failed after the user
 * was created we would leave an orphaned account that can sign in but has no
 * profile — so the user is rolled back explicitly on failure. A transaction
 * would be tidier, but this must also work on a standalone `mongod` where
 * transactions are unavailable.
 */
export async function createDoctor(auth: AuthContext, input: CreateDoctorInput) {
  const clinicId = resolveClinicForCreate(auth, input.clinicId);

  const clinic = await Clinic.findById(clinicId).select('_id currency').lean();
  if (!clinic) {
    throw ApiError.validation([{ field: 'clinicId', message: 'That clinic does not exist' }]);
  }

  const existing = await User.findOne({ email: input.email }).select('_id').lean();
  if (existing) {
    throw ApiError.conflict(ERROR_CODES.EMAIL_ALREADY_REGISTERED);
  }

  const inviteToken = input.sendInvite ? generateSecureToken(32) : null;

  const user = await User.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    ...(input.phone ? { phone: input.phone } : {}),
    role: Role.DOCTOR,
    clinic: clinicId,
    /* An invited account cannot sign in until the invitation is accepted. */
    status: input.sendInvite ? UserStatus.INVITED : UserStatus.ACTIVE,
    passwordHash: await hashPassword(input.password ?? generateSecureToken(24)),
    invitedBy: auth.userId,
    ...(inviteToken
      ? {
          inviteTokenHash: hashToken(inviteToken),
          inviteExpiresAt: new Date(Date.now() + SECURITY.INVITE_TTL_DAYS * 86_400_000),
        }
      : {}),
  });

  let doctor: DoctorDocument;

  try {
    doctor = await Doctor.create({
      user: user._id,
      clinic: clinicId,
      title: input.title,
      bio: input.bio,
      specializations: input.specializations,
      qualifications: input.qualifications,
      licenseNumber: input.licenseNumber,
      ...(input.licenseExpiresAt
        ? { licenseExpiresAt: new Date(`${input.licenseExpiresAt}T00:00:00.000Z`) }
        : {}),
      yearsOfExperience: input.yearsOfExperience,
      languages: input.languages.length > 0 ? input.languages : ['English'],
      consultationFeeMinor: input.consultationFeeMinor,
      currency: clinic.currency,
    });
  } catch (error) {
    /* Roll back the account so a failed profile write does not leave a
       sign-in-capable user with nothing behind it. */
    await User.deleteOne({ _id: user._id });
    throw error;
  }

  await Clinic.updateOne({ _id: clinicId }, { $inc: { 'stats.doctorCount': 1 } });

  if (inviteToken) {
    const inviter = await User.findById(auth.userId).select('firstName lastName').lean();

    void sendEmail(
      inviteEmail(
        user.email,
        user.firstName,
        inviteToken,
        inviter ? `${inviter.firstName} ${inviter.lastName}`.trim() : 'Your clinic',
        'veterinarian',
      ),
    );
  }

  return toDoctorDTO(doctor, user);
}

function resolveClinicForCreate(auth: AuthContext, requested?: string): Types.ObjectId {
  /* A super admin must say which clinic; an admin may only use their own, and
     a requested clinic id from them is ignored rather than honoured. */
  if (auth.role === Role.SUPER_ADMIN) {
    if (!requested) {
      throw ApiError.validation([{ field: 'clinicId', message: 'Choose a clinic' }]);
    }
    return toObjectId(requested, 'clinicId');
  }

  if (!auth.clinicId) {
    throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
  }

  return auth.clinicId;
}

export async function updateDoctor(auth: AuthContext, doctorId: string, input: UpdateDoctorInput) {
  const doctor = await loadDoctorForWrite(auth, doctorId);

  if (input.title !== undefined) doctor.title = input.title;
  if (input.bio !== undefined) doctor.bio = input.bio;
  if (input.specializations !== undefined) doctor.specializations = input.specializations;
  if (input.qualifications !== undefined) doctor.qualifications = input.qualifications;
  if (input.yearsOfExperience !== undefined) doctor.yearsOfExperience = input.yearsOfExperience;
  if (input.languages !== undefined) doctor.languages = input.languages;
  if (input.consultationFeeMinor !== undefined) {
    doctor.consultationFeeMinor = input.consultationFeeMinor;
  }
  if (input.isAcceptingPatients !== undefined) {
    doctor.isAcceptingPatients = input.isAcceptingPatients;
  }

  /**
   * Licence details are admin-only, even on a doctor's own profile.
   *
   * A clinician editing their own registration number is a compliance problem;
   * it is the clinic's record of their credentials, not their bio.
   */
  if (input.licenseNumber !== undefined || input.licenseExpiresAt !== undefined) {
    if (!auth.permissions.has('doctor:update:any')) {
      throw ApiError.forbidden(
        ERROR_CODES.INSUFFICIENT_PERMISSION,
        'Licence details can only be changed by a clinic admin.',
      );
    }

    if (input.licenseNumber !== undefined) doctor.licenseNumber = input.licenseNumber;
    if (input.licenseExpiresAt !== undefined) {
      doctor.licenseExpiresAt = new Date(`${input.licenseExpiresAt}T00:00:00.000Z`);
    }
  }

  await doctor.save();

  const user = await User.findById(doctor.user);
  if (!user) throw ApiError.notFound(ERROR_CODES.USER_NOT_FOUND);

  return toDoctorDTO(doctor, user);
}

/**
 * Load a doctor the caller may modify.
 *
 * A doctor may edit their own profile (`doctor:update:own`); an admin may edit
 * anyone in their clinic (`doctor:update:any`). The distinction is enforced
 * here rather than on the route, because the route cannot know whose profile
 * the id refers to.
 */
async function loadDoctorForWrite(auth: AuthContext, doctorId: string): Promise<DoctorDocument> {
  const id = toObjectId(doctorId, 'doctorId');
  const doctor = await Doctor.findById(id);

  if (!doctor) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that doctor.');
  }

  if (auth.role === Role.SUPER_ADMIN) return doctor;

  const isSelf = auth.doctorId?.toString() === doctor._id.toString();

  if (isSelf && auth.permissions.has('doctor:update:own')) return doctor;

  if (auth.permissions.has('doctor:update:any')) {
    if (auth.clinicId?.toString() !== doctor.clinic.toString()) {
      throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
    }
    return doctor;
  }

  throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);
}

/**
 * Deactivate a doctor.
 *
 * Refused while they still have upcoming appointments — those clients are
 * expecting to be seen, and silently deactivating the doctor would strand
 * bookings that no longer appear on anyone's calendar.
 */
export async function deactivateDoctor(auth: AuthContext, doctorId: string) {
  const doctor = await loadDoctorForWrite(auth, doctorId);

  const upcoming = await Appointment.countDocuments({
    doctor: doctor._id,
    status: { $in: [...SLOT_BLOCKING_STATUSES] },
    slotStart: { $gte: new Date() },
  });

  if (upcoming > 0) {
    throw ApiError.conflict(
      ERROR_CODES.DOCTOR_HAS_UPCOMING_APPOINTMENTS,
      `This doctor has ${upcoming} upcoming appointment${upcoming === 1 ? '' : 's'}. Reassign or cancel them first.`,
    );
  }

  const user = await User.findById(doctor.user);
  if (user) {
    assertCanActOnUser(auth.role, user.role);
    user.status = UserStatus.DEACTIVATED;
    await user.save();
  }

  doctor.isActive = false;
  doctor.isAcceptingPatients = false;
  await doctor.save();

  await Clinic.updateOne({ _id: doctor.clinic }, { $inc: { 'stats.doctorCount': -1 } });

  return { doctorId: doctor._id.toString(), isActive: false };
}
