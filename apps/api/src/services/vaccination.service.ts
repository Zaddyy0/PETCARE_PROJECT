/**
 * Vaccinations.
 *
 * A dose is the unit of work: one document per dose, each with its own due
 * date, reminder state and lifecycle. That shape is what makes "what is overdue
 * across the whole clinic" a plain indexed query rather than an array scan.
 */

import { Types } from 'mongoose';
import {
  ERROR_CODES,
  Role,
  VaccinationStatus,
  type CreateVaccinationInput,
  type UpdateVaccinationInput,
  type VaccinationListQueryInput,
  type VaccinationScheduleItem,
} from '@pawsitive/shared';
import { toVaccinationDTO, toVaccinationDetailDTO } from '../dto/medical.dto.js';
import { Doctor } from '../models/doctor.model.js';
import { Pet } from '../models/pet.model.js';
import { User } from '../models/user.model.js';
import { Vaccination, type VaccinationDocument } from '../models/vaccination.model.js';
import { ApiError } from '../utils/api-error.js';
import { buildPaginationMeta, resolvePage } from '../utils/pagination.js';
import type { AuthContext } from '../types/express.js';
import { loadPetForActor } from './pet.service.js';
import { toObjectId } from './scope.js';

export async function listVaccinations(auth: AuthContext, query: VaccinationListQueryInput) {
  const { page, limit, skip } = resolvePage(query);
  const filter: Record<string, unknown> = {};

  if (auth.role === Role.CLIENT) {
    const pets = await Pet.find({ owner: auth.userId }).select('_id').lean();

    if (pets.length === 0) {
      return { items: [], pagination: buildPaginationMeta(0, { page, limit }) };
    }

    filter['pet'] = { $in: pets.map((pet) => pet._id) };
  } else if (auth.role !== Role.SUPER_ADMIN) {
    if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
    filter['clinic'] = auth.clinicId;
  }

  if (query.petId) {
    await loadPetForActor(auth, query.petId);
    filter['pet'] = toObjectId(query.petId, 'petId');
  }

  if (query.status) filter['status'] = query.status;

  if (query.dueBefore || query.dueAfter) {
    const range: Record<string, Date> = {};
    if (query.dueAfter) range['$gte'] = new Date(query.dueAfter);
    if (query.dueBefore) range['$lte'] = new Date(query.dueBefore);
    filter['dueAt'] = range;
  }

  const [vaccinations, total] = await Promise.all([
    Vaccination.find(filter).sort({ dueAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    Vaccination.countDocuments(filter),
  ]);

  const names = await loadNames(vaccinations);

  const items = vaccinations.map((vaccination) =>
    toVaccinationDetailDTO(vaccination, {
      petName: names.pets.get(vaccination.pet.toString()) ?? 'Unknown',
      ...(vaccination.doctor
        ? { doctorName: names.doctors.get(vaccination.doctor.toString()) ?? undefined }
        : {}),
    }),
  );

  return { items, pagination: buildPaginationMeta(total, { page, limit }) };
}

async function loadNames(vaccinations: { pet: Types.ObjectId; doctor?: Types.ObjectId | null }[]) {
  const petIds = [...new Set(vaccinations.map((v) => v.pet.toString()))];
  const doctorIds = [
    ...new Set(vaccinations.flatMap((v) => (v.doctor ? [v.doctor.toString()] : []))),
  ];

  const [pets, doctors] = await Promise.all([
    petIds.length > 0 ? Pet.find({ _id: { $in: petIds } }).select('name').lean() : [],
    doctorIds.length > 0
      ? Doctor.find({ _id: { $in: doctorIds } }).select('user title').lean()
      : [],
  ]);

  const doctorUsers =
    doctors.length > 0
      ? await User.find({ _id: { $in: doctors.map((d) => d.user) } })
          .select('firstName lastName')
          .lean()
      : [];

  const userMap = new Map(
    doctorUsers.map((user) => [user._id.toString(), `${user.firstName} ${user.lastName}`.trim()]),
  );

  return {
    pets: new Map(pets.map((pet) => [pet._id.toString(), pet.name])),
    doctors: new Map(
      doctors.map((doctor) => [
        doctor._id.toString(),
        `${doctor.title} ${userMap.get(doctor.user.toString()) ?? ''}`.trim(),
      ]),
    ),
  };
}

/**
 * The "what's coming up" widget.
 *
 * Overdue first, then soonest — a single sort on `dueAt` gives exactly that,
 * because an overdue date is simply a smaller one.
 */
export async function getSchedule(
  auth: AuthContext,
  options: { withinDays?: number } = {},
): Promise<VaccinationScheduleItem[]> {
  const withinDays = options.withinDays ?? 60;
  const horizon = new Date(Date.now() + withinDays * 86_400_000);

  const petFilter =
    auth.role === Role.CLIENT
      ? { owner: auth.userId }
      : auth.role === Role.SUPER_ADMIN
        ? {}
        : null;

  let petIds: Types.ObjectId[];

  if (petFilter !== null) {
    const pets = await Pet.find({ ...petFilter, status: 'active' }).select('_id').lean();
    petIds = pets.map((pet) => pet._id);
  } else {
    if (!auth.clinicId) throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
    const clinicDoses = await Vaccination.find({ clinic: auth.clinicId }).select('pet').lean();
    petIds = [...new Set(clinicDoses.map((dose) => dose.pet.toString()))].map(
      (id) => new Types.ObjectId(id),
    );
  }

  if (petIds.length === 0) return [];

  const doses = await Vaccination.find({
    pet: { $in: petIds },
    status: { $in: [VaccinationStatus.SCHEDULED, VaccinationStatus.OVERDUE] },
    dueAt: { $lte: horizon },
  })
    .sort({ dueAt: 1 })
    .limit(100)
    .lean();

  const pets = await Pet.find({ _id: { $in: doses.map((dose) => dose.pet) } })
    .select('name photo')
    .lean();

  const petMap = new Map(pets.map((pet) => [pet._id.toString(), pet]));
  const now = Date.now();

  return doses.flatMap((dose) => {
    const pet = petMap.get(dose.pet.toString());
    if (!pet) return [];

    const daysUntilDue = Math.ceil((dose.dueAt.getTime() - now) / 86_400_000);

    return [
      {
        petId: pet._id.toString(),
        petName: pet.name,
        ...(pet.photo ? { petPhoto: { url: pet.photo.url, publicId: pet.photo.publicId } } : {}),
        vaccineName: dose.vaccineName,
        dueAt: dose.dueAt.toISOString(),
        daysUntilDue,
        status: dose.status,
        isOverdue: daysUntilDue < 0,
      },
    ];
  });
}

export async function createVaccination(auth: AuthContext, input: CreateVaccinationInput) {
  if (!auth.permissions.has('vaccination:write')) {
    throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);
  }

  const pet = await loadPetForActor(auth, input.petId);

  const doctor = auth.doctorId
    ? await Doctor.findById(auth.doctorId).select('clinic').lean()
    : null;

  const clinicId = doctor?.clinic ?? auth.clinicId;

  if (!clinicId) {
    throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
  }

  try {
    const vaccination = await Vaccination.create({
      pet: pet._id,
      ...(auth.doctorId ? { doctor: auth.doctorId } : {}),
      clinic: clinicId,
      ...(input.medicalRecordId
        ? { medicalRecord: toObjectId(input.medicalRecordId, 'medicalRecordId') }
        : {}),
      vaccineName: input.vaccineName,
      ...(input.manufacturer ? { manufacturer: input.manufacturer } : {}),
      ...(input.batchNumber ? { batchNumber: input.batchNumber } : {}),
      doseNumber: input.doseNumber,
      ...(input.totalDoses != null ? { totalDoses: input.totalDoses } : {}),
      ...(input.administeredAt ? { administeredAt: new Date(input.administeredAt) } : {}),
      dueAt: new Date(input.dueAt),
      ...(input.notes ? { notes: input.notes } : {}),
    });

    return toVaccinationDTO(vaccination);
  } catch (error) {
    /* The `uniq_pet_vaccine_dose` index catches a dose being recorded twice —
       an easy double-submit, and one that would show the owner a duplicate on
       their pet's vaccination card. */
    if ((error as { code?: number }).code === 11000) {
      throw ApiError.conflict(
        ERROR_CODES.CONFLICT,
        `Dose ${input.doseNumber} of ${input.vaccineName} is already recorded for this pet.`,
      );
    }
    throw error;
  }
}

export async function updateVaccination(
  auth: AuthContext,
  vaccinationId: string,
  input: UpdateVaccinationInput,
) {
  const vaccination = await loadForWrite(auth, vaccinationId);

  if (input.vaccineName !== undefined) vaccination.vaccineName = input.vaccineName;
  if (input.manufacturer !== undefined) vaccination.manufacturer = input.manufacturer;
  if (input.batchNumber !== undefined) vaccination.batchNumber = input.batchNumber;
  if (input.doseNumber !== undefined) vaccination.doseNumber = input.doseNumber;
  if (input.totalDoses !== undefined) vaccination.totalDoses = input.totalDoses;
  if (input.dueAt !== undefined) vaccination.dueAt = new Date(input.dueAt);
  if (input.notes !== undefined) vaccination.notes = input.notes;

  if (input.administeredAt !== undefined) {
    vaccination.administeredAt = new Date(input.administeredAt);
    /* The model's pre-save hook flips the status to `administered`, which also
       takes the dose out of the reminder scan. */
  }

  if (input.status !== undefined && input.administeredAt === undefined) {
    vaccination.status = input.status;
  }

  await vaccination.save();
  return toVaccinationDTO(vaccination);
}

async function loadForWrite(
  auth: AuthContext,
  vaccinationId: string,
): Promise<VaccinationDocument> {
  if (!auth.permissions.has('vaccination:write')) {
    throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);
  }

  const vaccination = await Vaccination.findById(toObjectId(vaccinationId, 'vaccinationId'));

  if (!vaccination) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that vaccination.');
  }

  if (
    auth.role !== Role.SUPER_ADMIN &&
    vaccination.clinic.toString() !== auth.clinicId?.toString()
  ) {
    throw ApiError.notFound(ERROR_CODES.NOT_FOUND, 'We could not find that vaccination.');
  }

  return vaccination;
}

/**
 * Sweep scheduled doses whose due date has passed into `overdue`.
 *
 * Run nightly. Backed by the partial `vaccination_due_scan` index, so it only
 * ever touches doses that can still change state rather than the entire
 * historical collection.
 */
export async function sweepOverdue(): Promise<number> {
  const result = await Vaccination.updateMany(
    { status: VaccinationStatus.SCHEDULED, dueAt: { $lt: new Date() } },
    { $set: { status: VaccinationStatus.OVERDUE } },
  );

  return result.modifiedCount;
}
