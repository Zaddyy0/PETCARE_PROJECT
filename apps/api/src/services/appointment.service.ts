/**
 * Appointments — booking, rescheduling and the status lifecycle.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  HOW BOOKING STAYS CORRECT UNDER CONCURRENCY
 * ────────────────────────────────────────────────────────────────────────────
 *
 * There are two distinct questions, and they are answered in two different
 * places on purpose:
 *
 *   "Is this a real slot?"   — validated here, before the write.
 *                              Covers: the time exists on the doctor's grid,
 *                              it is not in the past, it respects the notice
 *                              and advance windows, the doctor is accepting
 *                              patients. None of these are races: the answer
 *                              does not change between two concurrent requests.
 *
 *   "Is this slot free?"     — answered by the database, *during* the write.
 *                              This one IS a race, and no amount of checking
 *                              beforehand can settle it, because both requests
 *                              would pass the check before either inserts.
 *
 * So we deliberately do **not** check whether the slot is taken. We attempt the
 * insert and let the partial unique index reject the loser, then translate
 * E11000 into a clean 409. Adding a pre-check would not make this safer — it
 * would only make the common case slower and give a false impression that the
 * application logic is what prevents double-booking.
 */

import { Types } from 'mongoose';
import {
  APPOINTMENT_STATUS_LABELS,
  AppointmentStatus,
  ERROR_CODES,
  NotificationType,
  PetStatus,
  Role,
  SLOT_BLOCKING_STATUSES,
  SocketRoom,
  allowedTransitionsFor,
  canCancel,
  canReschedule,
  isLegalTransition,
  isTerminal,
  type AppointmentListQueryInput,
  type CreateAppointmentInput,
  type RescheduleAppointmentInput,
  type TransitionAppointmentInput,
} from '@pawsitive/shared';
import {
  toAppointmentDTO,
  toAppointmentDetailDTO,
  toCalendarEntryDTO,
  type AppointmentRelations,
} from '../dto/appointment.dto.js';
import { Appointment, type AppointmentDocument } from '../models/appointment.model.js';
import { Doctor } from '../models/doctor.model.js';
import { Pet } from '../models/pet.model.js';
import { User } from '../models/user.model.js';
import { emitToRooms } from '../realtime/emitter.js';
import { ApiError } from '../utils/api-error.js';
import { buildPaginationMeta, buildSort, resolvePage } from '../utils/pagination.js';
import type { AuthContext } from '../types/express.js';
import { assertSlotIsBookable } from './doctor.service.js';
import {
  appointmentCancelledEmail,
  appointmentConfirmedEmail,
} from './email.service.js';
import { notify } from './notification.service.js';
import { refreshPetTimeline } from './pet.service.js';
import { toObjectId } from './scope.js';

const SORTABLE = ['slotStart', 'createdAt', 'status'] as const;

/* -------------------------------------------------------------------------- */
/*                                   Booking                                  */
/* -------------------------------------------------------------------------- */

export async function bookAppointment(auth: AuthContext, input: CreateAppointmentInput) {
  const now = new Date();

  /* ---- Who is this for? ------------------------------------------------- */
  let clientId = auth.userId;

  if (input.clientId && auth.role !== Role.CLIENT) {
    clientId = toObjectId(input.clientId, 'clientId');
  }

  /* ---- The pet must exist, be active, and belong to that client. -------- */
  const pet = await Pet.findById(toObjectId(input.petId, 'petId'));

  if (!pet) {
    throw ApiError.notFound(ERROR_CODES.PET_NOT_FOUND);
  }

  /**
   * A client may only book their own pets.
   *
   * Checked against `clientId` rather than `auth.userId` so that staff booking
   * on someone's behalf still get a consistent rule: the pet must belong to
   * whoever the appointment is for.
   */
  if (pet.owner.toString() !== clientId.toString()) {
    if (auth.role === Role.CLIENT) {
      throw ApiError.notFound(ERROR_CODES.PET_NOT_FOUND);
    }
    throw ApiError.validation([
      { field: 'petId', message: 'That pet does not belong to this client' },
    ]);
  }

  if (pet.status !== PetStatus.ACTIVE) {
    throw ApiError.conflict(ERROR_CODES.PET_ARCHIVED, 'Restore this pet before booking.');
  }

  /* ---- The doctor, and whether this slot is real. ----------------------- */
  const doctor = await Doctor.findById(toObjectId(input.doctorId, 'doctorId'));

  if (!doctor || !doctor.isActive) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that doctor.');
  }

  const slotStart = new Date(input.slotStart);

  if (Number.isNaN(slotStart.getTime())) {
    throw ApiError.badRequest(ERROR_CODES.APPOINTMENT_SLOT_INVALID);
  }

  /* Validates the grid, the notice window and the advance limit — everything
     except whether the slot is taken. See the header. */
  await assertSlotIsBookable(doctor, slotStart, now);

  /* ---- Write, and let the index arbitrate. ------------------------------ */
  let appointment: AppointmentDocument;

  try {
    appointment = await Appointment.create({
      client: clientId,
      pet: pet._id,
      doctor: doctor._id,
      clinic: doctor.clinic,
      slotStart,
      durationMinutes: doctor.availability.slotDurationMinutes,
      type: input.type,
      reason: input.reason,
      ...(input.clientNotes ? { clientNotes: input.clientNotes } : {}),
      status: AppointmentStatus.PENDING,
      feeAmountMinor: doctor.consultationFeeMinor,
      feeCurrency: doctor.currency,
      createdBy: auth.userId,
    });
  } catch (error) {
    /* The error handler maps E11000 on the slot indexes to a 409 with
       APPOINTMENT_SLOT_TAKEN, which the client turns into "that time was just
       taken" plus a refreshed grid. Nothing to do here but let it through. */
    throw error;
  }

  await refreshPetTimeline(pet._id);

  void announce(appointment, 'appointment:created');
  void notifyBooking(appointment, pet.name);

  return toAppointmentDTO(appointment);
}

/* -------------------------------------------------------------------------- */
/*                                 Reschedule                                 */
/* -------------------------------------------------------------------------- */

/**
 * Move an appointment to a new time, and optionally a new doctor.
 *
 * Implemented as **cancel-and-recreate**, not as an in-place update of
 * `slotStart`. Two reasons:
 *
 *   1. An in-place update races exactly like a booking does, but a failed
 *      update leaves the original appointment already mutated. Creating the
 *      replacement first means a lost race changes nothing.
 *   2. The pair of records preserves the history — `rescheduledFrom` and
 *      `rescheduledTo` link them, so "this was moved twice" is visible rather
 *      than an appointment that mysteriously has a different time than the
 *      confirmation email said.
 */
export async function rescheduleAppointment(
  auth: AuthContext,
  appointmentId: string,
  input: RescheduleAppointmentInput,
) {
  const now = new Date();
  const original = await loadAppointmentForActor(auth, appointmentId);

  if (!canReschedule(original.status, original.slotStart, auth.role, now)) {
    if (isTerminal(original.status)) {
      throw ApiError.conflict(ERROR_CODES.APPOINTMENT_ALREADY_TERMINAL);
    }
    throw ApiError.forbidden(ERROR_CODES.APPOINTMENT_CANCELLATION_WINDOW_PASSED);
  }

  const doctorId = input.doctorId
    ? toObjectId(input.doctorId, 'doctorId')
    : original.doctor;

  const doctor = await Doctor.findById(doctorId);

  if (!doctor || !doctor.isActive) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that doctor.');
  }

  const slotStart = new Date(input.slotStart);
  await assertSlotIsBookable(doctor, slotStart, now);

  /* Create the replacement first. If the slot is taken, this throws and the
     original is untouched. */
  const replacement = await Appointment.create({
    client: original.client,
    pet: original.pet,
    doctor: doctor._id,
    clinic: doctor.clinic,
    slotStart,
    durationMinutes: doctor.availability.slotDurationMinutes,
    type: original.type,
    reason: original.reason,
    ...(original.clientNotes ? { clientNotes: original.clientNotes } : {}),
    status: original.status === AppointmentStatus.CONFIRMED
      ? AppointmentStatus.CONFIRMED
      : AppointmentStatus.PENDING,
    feeAmountMinor: doctor.consultationFeeMinor,
    feeCurrency: doctor.currency,
    createdBy: auth.userId,
    rescheduledFrom: original._id,
  });

  /* Only now retire the original — this also frees its slot. */
  original.status = AppointmentStatus.CANCELLED;
  original.blocksSlot = false;
  original.cancelledAt = now;
  original.cancelledBy = auth.role === Role.CLIENT ? 'client' : 'admin';
  original.cancellationReason = input.reason ?? 'Rescheduled';
  original.rescheduledTo = replacement._id;
  await original.save();

  await refreshPetTimeline(original.pet);

  void announce(replacement, 'appointment:updated');

  return toAppointmentDTO(replacement);
}

/* -------------------------------------------------------------------------- */
/*                              Status transitions                            */
/* -------------------------------------------------------------------------- */

/**
 * Drive the appointment state machine.
 *
 * Two independent checks, both required:
 *   • Is the edge legal at all?  (`pending → completed` is not)
 *   • May this role drive it?    (a client cannot confirm their own booking)
 *
 * Both come from the shared package, so the buttons the UI renders and the
 * transitions the server accepts are derived from one table.
 */
export async function transitionAppointment(
  auth: AuthContext,
  appointmentId: string,
  input: TransitionAppointmentInput,
) {
  const appointment = await loadAppointmentForActor(auth, appointmentId);
  const from = appointment.status;
  const to = input.status;

  if (from === to) {
    return toAppointmentDTO(appointment);
  }

  if (isTerminal(from)) {
    throw ApiError.conflict(
      ERROR_CODES.APPOINTMENT_ALREADY_TERMINAL,
      `This appointment is already ${APPOINTMENT_STATUS_LABELS[from].toLowerCase()}.`,
    );
  }

  if (!isLegalTransition(from, to)) {
    throw ApiError.conflict(
      ERROR_CODES.APPOINTMENT_INVALID_TRANSITION,
      `An appointment cannot go from ${APPOINTMENT_STATUS_LABELS[from].toLowerCase()} to ${APPOINTMENT_STATUS_LABELS[to].toLowerCase()}.`,
    );
  }

  if (!allowedTransitionsFor(from, auth.role).includes(to)) {
    throw ApiError.forbidden(
      ERROR_CODES.INSUFFICIENT_PERMISSION,
      'Your role cannot make that change.',
    );
  }

  /* Cancellation has its own rules (the window, the reason) — route it there
     rather than duplicating them. */
  if (to === AppointmentStatus.CANCELLED) {
    return cancelAppointment(auth, appointmentId, {
      reason: input.reason ?? 'Cancelled by the clinic',
    });
  }

  const now = new Date();
  appointment.status = to;

  /* Each lifecycle timestamp is written exactly once, when it happens. */
  if (to === AppointmentStatus.CONFIRMED) appointment.confirmedAt = now;
  if (to === AppointmentStatus.IN_PROGRESS) appointment.startedAt = now;
  if (to === AppointmentStatus.COMPLETED) appointment.completedAt = now;

  await appointment.save();
  await refreshPetTimeline(appointment.pet);

  void announce(appointment, 'appointment:updated');

  if (to === AppointmentStatus.CONFIRMED) {
    void notifyConfirmed(appointment);
  }

  return toAppointmentDTO(appointment);
}

export async function cancelAppointment(
  auth: AuthContext,
  appointmentId: string,
  input: { reason: string },
) {
  const now = new Date();
  const appointment = await loadAppointmentForActor(auth, appointmentId);

  const verdict = canCancel(appointment.status, appointment.slotStart, auth.role, now);

  if (!verdict.allowed) {
    if (verdict.reason === 'APPOINTMENT_ALREADY_TERMINAL') {
      throw ApiError.conflict(ERROR_CODES.APPOINTMENT_ALREADY_TERMINAL);
    }
    throw ApiError.forbidden(ERROR_CODES.APPOINTMENT_CANCELLATION_WINDOW_PASSED);
  }

  appointment.status = AppointmentStatus.CANCELLED;
  appointment.cancelledAt = now;
  appointment.cancelledBy =
    auth.role === Role.CLIENT ? 'client' : auth.role === Role.DOCTOR ? 'doctor' : 'admin';
  appointment.cancellationReason = input.reason;

  /* The pre-save hook derives `blocksSlot` from the status, which is what
     releases the slot for rebooking. */
  await appointment.save();
  await refreshPetTimeline(appointment.pet);

  void announce(appointment, 'appointment:cancelled');
  void notifyCancelled(appointment, input.reason);

  return toAppointmentDTO(appointment);
}

/* -------------------------------------------------------------------------- */
/*                                   Reading                                  */
/* -------------------------------------------------------------------------- */

export async function listAppointments(auth: AuthContext, query: AppointmentListQueryInput) {
  const { page, limit, skip } = resolvePage(query);
  const filter = buildAppointmentScope(auth, query);

  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    filter['status'] = { $in: statuses };
  }

  if (query.type) filter['type'] = query.type;
  if (query.petId) filter['pet'] = toObjectId(query.petId, 'petId');

  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range['$gte'] = new Date(query.from);
    if (query.to) range['$lt'] = new Date(query.to);
    filter['slotStart'] = range;
  }

  const sort = buildSort(query.sort, query.order, SORTABLE, 'slotStart');

  const [appointments, total] = await Promise.all([
    Appointment.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Appointment.countDocuments(filter),
  ]);

  const relations = await loadRelations(appointments);

  const items = appointments.flatMap((appointment) => {
    const related = relations.get(appointment._id.toString());
    if (!related) return [];
    return [
      toAppointmentDetailDTO(appointment, related, { role: auth.role, userId: auth.userId }),
    ];
  });

  return { items, pagination: buildPaginationMeta(total, { page, limit }) };
}

/**
 * Build the mandatory scope filter for an appointment query.
 *
 * Written out per role rather than via the generic helper, because
 * appointments have three different owning fields — a client owns via
 * `client`, a doctor via `doctor`, staff via `clinic` — and conflating them is
 * how a doctor ends up seeing the whole clinic's calendar.
 */
function buildAppointmentScope(
  auth: AuthContext,
  query: AppointmentListQueryInput,
): Record<string, unknown> {
  switch (auth.role) {
    case Role.SUPER_ADMIN: {
      const filter: Record<string, unknown> = {};
      if (query.clinicId) filter['clinic'] = toObjectId(query.clinicId, 'clinicId');
      if (query.doctorId) filter['doctor'] = toObjectId(query.doctorId, 'doctorId');
      if (query.clientId) filter['client'] = toObjectId(query.clientId, 'clientId');
      return filter;
    }

    case Role.ADMIN: {
      if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);

      const filter: Record<string, unknown> = { clinic: auth.clinicId };
      if (query.doctorId) filter['doctor'] = toObjectId(query.doctorId, 'doctorId');
      if (query.clientId) filter['client'] = toObjectId(query.clientId, 'clientId');
      return filter;
    }

    case Role.DOCTOR: {
      if (!auth.doctorId) throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);

      /* Pinned to their own id — a `?doctorId=` from a doctor is ignored, not
         honoured, so one clinician cannot read another's list. */
      const filter: Record<string, unknown> = { doctor: auth.doctorId };
      if (query.clientId) filter['client'] = toObjectId(query.clientId, 'clientId');
      return filter;
    }

    case Role.CLIENT:
    default:
      /* Their own appointments, full stop. Every caller-supplied owner filter
         is discarded. */
      return { client: auth.userId };
  }
}

export async function getAppointment(auth: AuthContext, appointmentId: string) {
  const appointment = await loadAppointmentForActor(auth, appointmentId);
  const relations = await loadRelations([appointment]);
  const related = relations.get(appointment._id.toString());

  if (!related) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND);
  }

  return toAppointmentDetailDTO(appointment, related, {
    role: auth.role,
    userId: auth.userId,
  });
}

/**
 * Load an appointment the caller is entitled to act on, or 404.
 *
 * 404 rather than 403 throughout: appointment ids are opaque, and confirming
 * that an id exists but belongs to someone else is information a caller has no
 * right to.
 */
export async function loadAppointmentForActor(
  auth: AuthContext,
  appointmentId: string,
): Promise<AppointmentDocument> {
  const id = toObjectId(appointmentId, 'appointmentId');
  const appointment = await Appointment.findById(id);

  if (!appointment) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that appointment.');
  }

  switch (auth.role) {
    case Role.SUPER_ADMIN:
      return appointment;

    case Role.ADMIN:
      if (appointment.clinic.toString() !== auth.clinicId?.toString()) {
        throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that appointment.');
      }
      return appointment;

    case Role.DOCTOR:
      if (appointment.doctor.toString() !== auth.doctorId?.toString()) {
        throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that appointment.');
      }
      return appointment;

    case Role.CLIENT:
    default:
      if (appointment.client.toString() !== auth.userId.toString()) {
        throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that appointment.');
      }
      return appointment;
  }
}

/**
 * Batch-load the joined fragments for a page of appointments.
 *
 * Four queries regardless of page size. The obvious alternative — populating
 * per row — is `4 × pageSize` round trips, which is the difference between a
 * calendar that renders instantly and one that takes two seconds.
 */
async function loadRelations(
  appointments: { _id: Types.ObjectId; pet: Types.ObjectId; client: Types.ObjectId; doctor: Types.ObjectId }[],
): Promise<Map<string, AppointmentRelations>> {
  if (appointments.length === 0) return new Map();

  const petIds = [...new Set(appointments.map((a) => a.pet.toString()))];
  const clientIds = [...new Set(appointments.map((a) => a.client.toString()))];
  const doctorIds = [...new Set(appointments.map((a) => a.doctor.toString()))];

  const [pets, clients, doctors] = await Promise.all([
    Pet.find({ _id: { $in: petIds } }).select('name species breed photo').lean(),
    User.find({ _id: { $in: clientIds } }).select('firstName lastName email phone avatar').lean(),
    Doctor.find({ _id: { $in: doctorIds } })
      .select('user title specializations ratingAverage')
      .lean(),
  ]);

  const doctorUsers = await User.find({ _id: { $in: doctors.map((d) => d.user) } })
    .select('firstName lastName avatar')
    .lean();

  const petMap = new Map(pets.map((pet) => [pet._id.toString(), pet]));
  const clientMap = new Map(clients.map((client) => [client._id.toString(), client]));
  const doctorMap = new Map(doctors.map((doctor) => [doctor._id.toString(), doctor]));
  const doctorUserMap = new Map(doctorUsers.map((user) => [user._id.toString(), user]));

  const relations = new Map<string, AppointmentRelations>();

  for (const appointment of appointments) {
    const pet = petMap.get(appointment.pet.toString());
    const client = clientMap.get(appointment.client.toString());
    const doctor = doctorMap.get(appointment.doctor.toString());
    const doctorUser = doctor ? doctorUserMap.get(doctor.user.toString()) : undefined;

    if (!pet || !client || !doctor || !doctorUser) continue;

    relations.set(appointment._id.toString(), {
      pet: pet as AppointmentRelations['pet'],
      client: client as AppointmentRelations['client'],
      doctor: doctor as AppointmentRelations['doctor'],
      doctorUser: doctorUser as AppointmentRelations['doctorUser'],
    });
  }

  return relations;
}

/** Compact calendar payload for a date window. */
export async function getCalendar(
  auth: AuthContext,
  query: { from: string; to: string; doctorId?: string; clinicId?: string },
) {
  const filter = buildAppointmentScope(auth, {
    ...(query.doctorId ? { doctorId: query.doctorId } : {}),
    ...(query.clinicId ? { clinicId: query.clinicId } : {}),
  } as AppointmentListQueryInput);

  filter['slotStart'] = { $gte: new Date(query.from), $lt: new Date(query.to) };
  filter['status'] = { $ne: AppointmentStatus.CANCELLED };

  /* Capped: a badly-chosen range should return a bounded payload rather than a
     year of appointments. */
  const appointments = await Appointment.find(filter).sort({ slotStart: 1 }).limit(1000).lean();

  const relations = await loadRelations(appointments);

  return appointments.flatMap((appointment) => {
    const related = relations.get(appointment._id.toString());
    if (!related) return [];

    return [
      toCalendarEntryDTO(appointment, {
        petName: related.pet.name,
        clientName: `${related.client.firstName} ${related.client.lastName}`.trim(),
        doctorName: `${related.doctorUser.firstName} ${related.doctorUser.lastName}`.trim(),
      }),
    ];
  });
}

/* -------------------------------------------------------------------------- */
/*                          Realtime & notifications                          */
/* -------------------------------------------------------------------------- */

/**
 * Announce a change to everyone entitled to see it.
 *
 * Emitted to three rooms — the client, the doctor, the clinic — so a booking
 * appears on the doctor's calendar and the admin's dashboard without either
 * polling. Room membership is decided at connect time from the authenticated
 * identity, so this cannot reach anyone who should not see it.
 */
function announce(
  appointment: AppointmentDocument,
  event: 'appointment:created' | 'appointment:updated' | 'appointment:cancelled',
): void {
  emitToRooms(
    [
      SocketRoom.user(appointment.client.toString()),
      SocketRoom.doctor(appointment.doctor.toString()),
      SocketRoom.clinic(appointment.clinic.toString()),
    ],
    event,
    {
      appointmentId: appointment._id.toString(),
      doctorId: appointment.doctor.toString(),
      clientId: appointment.client.toString(),
      clinicId: appointment.clinic.toString(),
      petId: appointment.pet.toString(),
      slotStart: appointment.slotStart.toISOString(),
      status: appointment.status,
    },
  );
}

async function notifyBooking(appointment: AppointmentDocument, petName: string): Promise<void> {
  const doctor = await Doctor.findById(appointment.doctor).select('user').lean();
  if (!doctor) return;

  await notify({
    userId: doctor.user,
    type: NotificationType.APPOINTMENT_BOOKED,
    title: 'New appointment request',
    body: `${petName} has been booked in for ${appointment.slotStart.toUTCString()}.`,
    data: { appointmentId: appointment._id.toString() },
    actionUrl: `/app/appointments/${appointment._id.toString()}`,
  });
}

async function notifyConfirmed(appointment: AppointmentDocument): Promise<void> {
  const [pet, doctor] = await Promise.all([
    Pet.findById(appointment.pet).select('name').lean(),
    Doctor.findById(appointment.doctor).select('user title').lean(),
  ]);

  const doctorUser = doctor
    ? await User.findById(doctor.user).select('firstName lastName').lean()
    : null;

  const doctorName = doctorUser
    ? `${doctor?.title ?? ''} ${doctorUser.firstName} ${doctorUser.lastName}`.trim()
    : 'your veterinarian';

  await notify({
    userId: appointment.client,
    type: NotificationType.APPOINTMENT_CONFIRMED,
    title: 'Appointment confirmed',
    body: `${pet?.name ?? 'Your pet'} is confirmed with ${doctorName}.`,
    data: { appointmentId: appointment._id.toString() },
    actionUrl: `/app/appointments/${appointment._id.toString()}`,
    email: (recipient) =>
      appointmentConfirmedEmail(recipient.email, recipient.name, {
        petName: pet?.name ?? 'your pet',
        doctorName,
        when: appointment.slotStart.toUTCString(),
        reference: appointment.reference,
      }),
  });
}

async function notifyCancelled(
  appointment: AppointmentDocument,
  reason: string,
): Promise<void> {
  const pet = await Pet.findById(appointment.pet).select('name').lean();

  await notify({
    userId: appointment.client,
    type: NotificationType.APPOINTMENT_CANCELLED,
    title: 'Appointment cancelled',
    body: `${pet?.name ?? 'Your pet'}'s appointment has been cancelled.`,
    data: { appointmentId: appointment._id.toString() },
    priority: 'high',
    email: (recipient) =>
      appointmentCancelledEmail(recipient.email, recipient.name, {
        petName: pet?.name ?? 'your pet',
        when: appointment.slotStart.toUTCString(),
        reason,
      }),
  });
}

export { SLOT_BLOCKING_STATUSES };
