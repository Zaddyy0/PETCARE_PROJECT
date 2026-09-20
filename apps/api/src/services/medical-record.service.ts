/**
 * Medical records.
 *
 * Two rules distinguish this from ordinary CRUD, and both are about the record
 * being defensible later rather than merely editable now:
 *
 *   • **Only the treating clinician may author or amend.** Holding
 *     `medical_record:write` is necessary but nowhere near sufficient — every
 *     doctor holds it. The check that matters is whether *this* clinician is
 *     treating *this* patient.
 *
 *   • **Edits become amendments once the record locks.** Inside a short window
 *     a clinician can freely correct their own notes. After that the prior text
 *     is preserved in `amendments` with a reason. A clinical history that can be
 *     silently rewritten is worth less than no history at all.
 *
 * Admins can read all of this and write none of it — clinical authorship stays
 * with licensed clinicians.
 */

import { Types } from 'mongoose';
import {
  AppointmentStatus,
  ERROR_CODES,
  MEDICAL,
  NotificationType,
  Role,
  type CreateMedicalRecordInput,
  type MedicalRecordListQueryInput,
  type UpdateMedicalRecordInput,
} from '@pawsitive/shared';
import { toMedicalRecordDTO } from '../dto/medical.dto.js';
import { Appointment } from '../models/appointment.model.js';
import { Doctor } from '../models/doctor.model.js';
import { MedicalRecord, type MedicalRecordDocument } from '../models/medical-record.model.js';
import { Pet } from '../models/pet.model.js';
import { ApiError } from '../utils/api-error.js';
import { buildPaginationMeta, resolvePage } from '../utils/pagination.js';
import type { AuthContext } from '../types/express.js';
import { notify } from './notification.service.js';
import { recordAudit, type AuditActor } from './audit.service.js';
import { loadPetForActor } from './pet.service.js';
import { toObjectId } from './scope.js';

/* -------------------------------------------------------------------------- */
/*                                    List                                    */
/* -------------------------------------------------------------------------- */

export async function listRecords(auth: AuthContext, query: MedicalRecordListQueryInput) {
  const { page, limit, skip } = resolvePage(query);
  const filter: Record<string, unknown> = {};

  /**
   * A client's scope is defined by their *pets*, not by a field on the record.
   *
   * There is no `client` column on a medical record — the owner is reached
   * through the pet. So we resolve their pet ids and constrain on those. An
   * empty list short-circuits rather than issuing a query with `$in: []`, which
   * would scan for nothing.
   */
  if (auth.role === Role.CLIENT) {
    const petIds = await Pet.find({ owner: auth.userId }).select('_id').lean();

    if (petIds.length === 0) {
      return { items: [], pagination: buildPaginationMeta(0, { page, limit }) };
    }

    filter['pet'] = { $in: petIds.map((pet) => pet._id) };
  } else if (auth.role === Role.DOCTOR) {
    /* A doctor sees the records they wrote, plus anything in their clinic for
       continuity of care — a colleague's notes on the same patient matter. */
    if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
    filter['clinic'] = auth.clinicId;
  } else if (auth.role === Role.ADMIN) {
    if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
    filter['clinic'] = auth.clinicId;
  }
  /* Super admin: no constraint. */

  if (query.petId) {
    const petId = toObjectId(query.petId, 'petId');

    /* Confirm reachability before narrowing, so a client cannot enumerate
       another owner's pet ids by watching which ones return empty. */
    await loadPetForActor(auth, query.petId);
    filter['pet'] = petId;
  }

  if (query.doctorId) filter['doctor'] = toObjectId(query.doctorId, 'doctorId');
  if (query.type) filter['type'] = query.type;

  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range['$gte'] = new Date(query.from);
    if (query.to) range['$lt'] = new Date(query.to);
    filter['visitDate'] = range;
  }

  const [records, total] = await Promise.all([
    MedicalRecord.find(filter).sort({ visitDate: -1, _id: -1 }).skip(skip).limit(limit),
    MedicalRecord.countDocuments(filter),
  ]);

  const items = records.map((record) => toMedicalRecordDTO(record, record.isEditable()));

  return { items, pagination: buildPaginationMeta(total, { page, limit }) };
}

export async function getRecord(auth: AuthContext, recordId: string) {
  const record = await loadRecordForRead(auth, recordId);
  return toMedicalRecordDTO(record, record.isEditable());
}

/* -------------------------------------------------------------------------- */
/*                                   Create                                   */
/* -------------------------------------------------------------------------- */

export async function createRecord(
  auth: AuthContext,
  input: CreateMedicalRecordInput,
  actor: AuditActor,
) {
  /* Only a clinician authors clinical content. A super admin technically holds
     the permission but has no Doctor profile to attribute the note to, which is
     itself the reason this is refused. */
  if (!auth.doctorId) {
    throw ApiError.forbidden(
      ERROR_CODES.NOT_TREATING_CLINICIAN,
      'Only a veterinarian can write a clinical record.',
    );
  }

  const pet = await loadPetForActor(auth, input.petId);

  const doctor = await Doctor.findById(auth.doctorId).select('clinic').lean();
  if (!doctor) {
    throw ApiError.forbidden(ERROR_CODES.NOT_TREATING_CLINICIAN);
  }

  /**
   * If the record is tied to an appointment, that appointment must be this
   * doctor's and must have actually happened.
   *
   * Without this, a clinician could attach notes to a colleague's visit, or to
   * a booking that was never attended — both of which corrupt the history and
   * the analytics built on it.
   */
  let appointmentId: Types.ObjectId | undefined;

  if (input.appointmentId) {
    const appointment = await Appointment.findById(toObjectId(input.appointmentId, 'appointmentId'));

    if (!appointment) {
      throw ApiError.validation([
        { field: 'appointmentId', message: 'That appointment does not exist' },
      ]);
    }

    if (appointment.doctor.toString() !== auth.doctorId.toString()) {
      throw ApiError.forbidden(
        ERROR_CODES.NOT_TREATING_CLINICIAN,
        'That appointment belongs to another clinician.',
      );
    }

    if (appointment.pet.toString() !== pet._id.toString()) {
      throw ApiError.validation([
        { field: 'appointmentId', message: 'That appointment is for a different pet' },
      ]);
    }

    if (
      appointment.status !== AppointmentStatus.COMPLETED &&
      appointment.status !== AppointmentStatus.IN_PROGRESS
    ) {
      throw ApiError.conflict(
        ERROR_CODES.CONFLICT,
        'Start or complete the appointment before writing up the visit.',
      );
    }

    appointmentId = appointment._id;
  }

  const record = await MedicalRecord.create({
    pet: pet._id,
    doctor: auth.doctorId,
    clinic: doctor.clinic,
    ...(appointmentId ? { appointment: appointmentId } : {}),
    type: input.type,
    visitDate: input.visitDate ? new Date(input.visitDate) : new Date(),
    chiefComplaint: input.chiefComplaint,
    diagnosis: input.diagnosis,
    treatment: input.treatment,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.vitals ? { vitals: input.vitals } : {}),
    prescriptions: (input.prescriptions ?? []).map((prescription) => ({
      ...prescription,
      ...(prescription.startDate
        ? { startDate: new Date(`${prescription.startDate}T00:00:00.000Z`) }
        : {}),
    })),
    followUpRequired: input.followUpRequired ?? false,
    ...(input.followUpDate
      ? { followUpDate: new Date(`${input.followUpDate}T00:00:00.000Z`) }
      : {}),
    ...(input.followUpNotes ? { followUpNotes: input.followUpNotes } : {}),
  });

  if (appointmentId) {
    await Appointment.updateOne({ _id: appointmentId }, { $set: { hasMedicalRecord: true } });
  }

  /* A weight recorded at a visit is the most current one we have. */
  if (input.vitals?.weightKg) {
    await Pet.updateOne({ _id: pet._id }, { $set: { weightKg: input.vitals.weightKg } });
  }

  void recordAudit({
    actor,
    action: 'medical_record.created',
    targetType: 'MedicalRecord',
    targetId: record._id,
    targetLabel: `${pet.name} — ${input.diagnosis.slice(0, 60)}`,
  });

  void notify({
    userId: pet.owner,
    type: NotificationType.MEDICAL_RECORD_ADDED,
    title: `New record for ${pet.name}`,
    body: 'Your veterinarian has added notes from the visit.',
    data: { petId: pet._id.toString(), recordId: record._id.toString() },
    actionUrl: `/app/pets/${pet._id.toString()}/records`,
  });

  return toMedicalRecordDTO(record, record.isEditable());
}

/* -------------------------------------------------------------------------- */
/*                              Update / amend                                */
/* -------------------------------------------------------------------------- */

/**
 * Correct a record, or amend a locked one.
 *
 * Inside `FREE_EDIT_WINDOW_HOURS` the author edits in place — a typo fixed ten
 * minutes later does not need a paper trail. Past that, the previous values are
 * snapshotted into `amendments` with a mandatory reason, and the original text
 * survives.
 */
export async function updateRecord(
  auth: AuthContext,
  recordId: string,
  input: UpdateMedicalRecordInput,
  actor: AuditActor,
) {
  const record = await loadRecordForWrite(auth, recordId);
  const isFreeEdit = record.isEditable();

  if (!isFreeEdit && !input.amendmentReason) {
    throw new ApiError({
      statusCode: 400,
      code: ERROR_CODES.AMENDMENT_REASON_REQUIRED,
      message: `This record locked after ${MEDICAL.FREE_EDIT_WINDOW_HOURS} hours. Give a reason for the amendment.`,
    });
  }

  /* Capture the prior values of exactly the fields being changed. */
  const previous: Record<string, unknown> = {};
  const changed: string[] = [];

  /**
   * A Mongoose document is not indexable by an arbitrary string, so the write
   * needs a cast. Confining it to this one helper — with the field name
   * constrained to `keyof` the document — keeps the loosening in a single
   * place, and a mistyped field name still fails to compile at the call site.
   */
  const mutable = record as unknown as Record<string, unknown>;

  const track = <K extends keyof typeof record>(field: K, next: unknown) => {
    if (next === undefined) return;

    const current = record[field];
    if (JSON.stringify(current) === JSON.stringify(next)) return;

    previous[field as string] = current;
    changed.push(field as string);
    mutable[field as string] = next;
  };

  track('type', input.type);
  track('visitDate', input.visitDate ? new Date(input.visitDate) : undefined);
  track('chiefComplaint', input.chiefComplaint);
  track('diagnosis', input.diagnosis);
  track('treatment', input.treatment);
  track('notes', input.notes);
  track('vitals', input.vitals);
  track(
    'prescriptions',
    input.prescriptions?.map((prescription) => ({
      ...prescription,
      ...(prescription.startDate
        ? { startDate: new Date(`${prescription.startDate}T00:00:00.000Z`) }
        : {}),
    })),
  );
  track('followUpRequired', input.followUpRequired);
  track(
    'followUpDate',
    input.followUpDate ? new Date(`${input.followUpDate}T00:00:00.000Z`) : undefined,
  );
  track('followUpNotes', input.followUpNotes);

  if (changed.length === 0) {
    return toMedicalRecordDTO(record, isFreeEdit);
  }

  if (!isFreeEdit) {
    record.amendments.push({
      amendedBy: auth.userId,
      amendedAt: new Date(),
      reason: input.amendmentReason as string,
      previousValues: previous,
    });
  }

  await record.save();

  void recordAudit({
    actor,
    action: 'medical_record.updated',
    targetType: 'MedicalRecord',
    targetId: record._id,
    changes: changed.map((field) => ({
      field,
      from: previous[field] ?? null,
      to: (record as unknown as Record<string, unknown>)[field] ?? null,
    })),
  });

  return toMedicalRecordDTO(record, record.isEditable());
}

/**
 * Lock a record explicitly, ending its free-edit window early.
 *
 * Used when a clinician signs off. There is deliberately no unlock: the whole
 * value of the lock is that it cannot be undone by the person it constrains.
 */
export async function lockRecord(auth: AuthContext, recordId: string, actor: AuditActor) {
  const record = await loadRecordForWrite(auth, recordId);

  if (record.lockedAt) {
    return toMedicalRecordDTO(record, false);
  }

  record.lockedAt = new Date();
  await record.save();

  void recordAudit({
    actor,
    action: 'medical_record.updated',
    targetType: 'MedicalRecord',
    targetId: record._id,
    changes: [{ field: 'lockedAt', from: null, to: record.lockedAt.toISOString() }],
  });

  return toMedicalRecordDTO(record, false);
}

/* -------------------------------------------------------------------------- */
/*                                   Loading                                  */
/* -------------------------------------------------------------------------- */

async function loadRecordForRead(
  auth: AuthContext,
  recordId: string,
): Promise<MedicalRecordDocument> {
  const record = await MedicalRecord.findById(toObjectId(recordId, 'recordId'));

  if (!record) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that record.');
  }

  if (auth.role === Role.SUPER_ADMIN) return record;

  if (auth.role === Role.CLIENT) {
    /* Reachable only through a pet they own. */
    const pet = await Pet.findOne({ _id: record.pet, owner: auth.userId }).select('_id').lean();

    if (!pet) {
      throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that record.');
    }

    return record;
  }

  /* Staff: same clinic. */
  if (record.clinic.toString() !== auth.clinicId?.toString()) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that record.');
  }

  return record;
}

/**
 * Load a record the caller may modify.
 *
 * Stricter than the read path in a way that matters: only the **authoring
 * clinician** may change their own notes. A colleague in the same clinic can
 * read them for continuity of care but cannot edit them, and an admin cannot
 * touch them at all — someone else's clinical judgement is not theirs to
 * revise.
 */
async function loadRecordForWrite(
  auth: AuthContext,
  recordId: string,
): Promise<MedicalRecordDocument> {
  const record = await MedicalRecord.findById(toObjectId(recordId, 'recordId'));

  if (!record) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that record.');
  }

  if (!auth.permissions.has('medical_record:write')) {
    throw ApiError.forbidden(
      ERROR_CODES.INSUFFICIENT_PERMISSION,
      'Only a veterinarian can change a clinical record.',
    );
  }

  if (!auth.doctorId || record.doctor.toString() !== auth.doctorId.toString()) {
    throw ApiError.forbidden(
      ERROR_CODES.NOT_TREATING_CLINICIAN,
      'Only the clinician who wrote this record can change it.',
    );
  }

  return record;
}

/** A pet's full clinical timeline, for the pet detail page. */
export async function getPetTimeline(auth: AuthContext, petId: string) {
  const pet = await loadPetForActor(auth, petId);

  const records = await MedicalRecord.find({ pet: pet._id })
    .sort({ visitDate: -1 })
    .limit(100);

  return records.map((record) => toMedicalRecordDTO(record, record.isEditable()));
}
