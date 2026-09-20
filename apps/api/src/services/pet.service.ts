/**
 * Pets.
 *
 * The reference implementation for how every service in this codebase handles
 * authorization: the route has already confirmed the *role* may do this, and
 * everything here confirms the *user* may do it to *this row*.
 */

import { Types } from 'mongoose';
import {
  AppointmentStatus,
  ERROR_CODES,
  LIMITS,
  PetStatus,
  Role,
  SLOT_BLOCKING_STATUSES,
  VaccinationStatus,
  type CreatePetInput,
  type PetListQueryInput,
  type UpdatePetInput,
} from '@pawsitive/shared';
import { toPetDTO, toPetSummaryDTO } from '../dto/pet.dto.js';
import { Appointment } from '../models/appointment.model.js';
import { Pet, type PetDocument } from '../models/pet.model.js';
import { User } from '../models/user.model.js';
import { Vaccination } from '../models/vaccination.model.js';
import { ApiError } from '../utils/api-error.js';
import {
  buildPaginationMeta,
  buildSearchFilter,
  buildSort,
  resolvePage,
} from '../utils/pagination.js';
import type { AuthContext } from '../types/express.js';
import { assertCanReach, buildScopeFilter, toObjectId } from './scope.js';

const SORTABLE = ['createdAt', 'name', 'nextAppointmentAt'] as const;

/* -------------------------------------------------------------------------- */
/*                                    List                                    */
/* -------------------------------------------------------------------------- */

export async function listPets(auth: AuthContext, query: PetListQueryInput) {
  const { page, limit, skip } = resolvePage(query);

  /* The scope filter is not optional and not conditional — it is the first
     thing in the filter and nothing can remove it. */
  const filter: Record<string, unknown> = {
    ...buildScopeFilter(auth, 'pet', { ownerField: 'owner', clinicField: 'clinic' }),
  };

  /* Clients see only their own pets by definition; staff may narrow to one
     owner. A client sending `?ownerId=` is ignored, not honoured. */
  if (query.ownerId && auth.role !== Role.CLIENT) {
    filter['owner'] = toObjectId(query.ownerId, 'ownerId');
  }

  if (query.species) filter['species'] = query.species;

  /* Archived pets are hidden unless explicitly asked for — an owner's list
     should not fill up with pets they have retired. */
  filter['status'] = query.status ?? PetStatus.ACTIVE;

  const search = buildSearchFilter(query.search, ['name', 'breed']);
  if (search) Object.assign(filter, search);

  const sort = buildSort(query.sort, query.order, SORTABLE, 'createdAt');

  const [pets, total] = await Promise.all([
    Pet.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Pet.countDocuments(filter),
  ]);

  /**
   * Counts for the whole page in two queries, not two per pet.
   *
   * The naive version issues `2 × pageSize` queries — 40 round trips to render
   * 20 cards. Aggregating over the page's ids keeps it flat regardless of page
   * size.
   */
  const petIds = pets.map((pet) => pet._id);
  const [upcoming, overdue, owners] = await Promise.all([
    countUpcomingAppointments(petIds),
    countOverdueVaccinations(petIds),
    auth.role === Role.CLIENT ? Promise.resolve(new Map<string, string>()) : loadOwnerNames(pets),
  ]);

  const items = pets.map((pet) =>
    toPetSummaryDTO(pet, {
      upcomingAppointmentCount: upcoming.get(pet._id.toString()) ?? 0,
      overdueVaccinationCount: overdue.get(pet._id.toString()) ?? 0,
      ...(owners.get(pet.owner.toString())
        ? { ownerName: owners.get(pet.owner.toString()) as string }
        : {}),
    }),
  );

  return { items, pagination: buildPaginationMeta(total, { page, limit }) };
}

async function countUpcomingAppointments(petIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (petIds.length === 0) return new Map();

  const rows = await Appointment.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        pet: { $in: petIds },
        status: { $in: [...SLOT_BLOCKING_STATUSES] },
        slotStart: { $gte: new Date() },
      },
    },
    { $group: { _id: '$pet', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

async function countOverdueVaccinations(petIds: Types.ObjectId[]): Promise<Map<string, number>> {
  if (petIds.length === 0) return new Map();

  const rows = await Vaccination.aggregate<{ _id: Types.ObjectId; count: number }>([
    {
      $match: {
        pet: { $in: petIds },
        /* Either already swept to `overdue`, or still `scheduled` with a due
           date in the past — the nightly job may not have run yet. */
        $or: [
          { status: VaccinationStatus.OVERDUE },
          { status: VaccinationStatus.SCHEDULED, dueAt: { $lt: new Date() } },
        ],
      },
    },
    { $group: { _id: '$pet', count: { $sum: 1 } } },
  ]);

  return new Map(rows.map((row) => [row._id.toString(), row.count]));
}

async function loadOwnerNames(
  pets: { owner: Types.ObjectId }[],
): Promise<Map<string, string>> {
  const ownerIds = [...new Set(pets.map((pet) => pet.owner.toString()))];
  if (ownerIds.length === 0) return new Map();

  const owners = await User.find({ _id: { $in: ownerIds } })
    .select('firstName lastName')
    .lean();

  return new Map(
    owners.map((owner) => [owner._id.toString(), `${owner.firstName} ${owner.lastName}`.trim()]),
  );
}

/* -------------------------------------------------------------------------- */
/*                                   Read one                                 */
/* -------------------------------------------------------------------------- */

export async function getPet(auth: AuthContext, petId: string) {
  const pet = await loadPetForActor(auth, petId);

  const [upcoming, overdue] = await Promise.all([
    countUpcomingAppointments([pet._id]),
    countOverdueVaccinations([pet._id]),
  ]);

  return toPetSummaryDTO(pet, {
    upcomingAppointmentCount: upcoming.get(pet._id.toString()) ?? 0,
    overdueVaccinationCount: overdue.get(pet._id.toString()) ?? 0,
  });
}

/**
 * Load a pet the caller is entitled to see, or 404.
 *
 * Shared by every operation here, so the ownership check cannot be forgotten on
 * one path and present on another.
 *
 * Clinic staff reach a pet through *care*, not through the pet record: a pet
 * has an owner but no clinic, so "is this pet in my clinic?" is really "has
 * this pet ever been booked with us?".
 */
export async function loadPetForActor(auth: AuthContext, petId: string): Promise<PetDocument> {
  const id = toObjectId(petId, 'petId');
  const pet = await Pet.findById(id);

  if (!pet) {
    throw ApiError.notFound(ERROR_CODES.PET_NOT_FOUND);
  }

  if (auth.role === Role.SUPER_ADMIN) return pet;

  if (auth.role === Role.CLIENT) {
    assertCanReach(auth, 'pet', { ownerId: pet.owner }, ERROR_CODES.PET_NOT_FOUND);
    return pet;
  }

  /* Doctor or admin: require a care relationship with this pet. */
  const treated = await Appointment.exists({
    pet: pet._id,
    ...(auth.role === Role.DOCTOR && auth.doctorId
      ? { doctor: auth.doctorId }
      : { clinic: auth.clinicId }),
  });

  if (!treated) {
    throw ApiError.notFound(ERROR_CODES.PET_NOT_FOUND);
  }

  return pet;
}

/* -------------------------------------------------------------------------- */
/*                                   Create                                   */
/* -------------------------------------------------------------------------- */

export async function createPet(auth: AuthContext, input: CreatePetInput) {
  /**
   * Whose pet is this?
   *
   * A client always creates for themselves — `ownerId` in their payload is
   * ignored outright, not validated, because there is no legitimate reason for
   * it to be there. Staff may create on a client's behalf.
   */
  let ownerId = auth.userId;

  if (input.ownerId && auth.permissions.has('pet:update:any')) {
    ownerId = toObjectId(input.ownerId, 'ownerId');

    const owner = await User.findById(ownerId).select('_id role').lean();
    if (!owner) {
      throw ApiError.validation([{ field: 'ownerId', message: 'That client does not exist' }]);
    }
    if (owner.role !== Role.CLIENT) {
      throw ApiError.validation([{ field: 'ownerId', message: 'Pets belong to client accounts' }]);
    }
  }

  /* A cap per account, so one script cannot fill the collection. */
  const existing = await Pet.countDocuments({ owner: ownerId, status: PetStatus.ACTIVE });
  if (existing >= LIMITS.MAX_PETS_PER_CLIENT) {
    throw new ApiError({ statusCode: 422, code: ERROR_CODES.PET_LIMIT_REACHED });
  }

  const pet = await Pet.create({
    owner: ownerId,
    name: input.name,
    species: input.species,
    sex: input.sex,
    isDateOfBirthApproximate: input.isDateOfBirthApproximate,
    allergies: input.allergies,
    chronicConditions: input.chronicConditions,
    currentMedications: input.currentMedications,
    isNeutered: input.isNeutered,
    isInsured: input.isInsured,
    ...(input.breed ? { breed: input.breed } : {}),
    ...(input.dateOfBirth ? { dateOfBirth: new Date(`${input.dateOfBirth}T00:00:00.000Z`) } : {}),
    ...(input.weightKg != null ? { weightKg: input.weightKg } : {}),
    ...(input.color ? { color: input.color } : {}),
    ...(input.microchipId ? { microchipId: input.microchipId } : {}),
    ...(input.insuranceProvider ? { insuranceProvider: input.insuranceProvider } : {}),
    ...(input.insurancePolicyNumber
      ? { insurancePolicyNumber: input.insurancePolicyNumber }
      : {}),
    ...(input.emergencyNotes ? { emergencyNotes: input.emergencyNotes } : {}),
  });

  return toPetDTO(pet);
}

/* -------------------------------------------------------------------------- */
/*                                   Update                                   */
/* -------------------------------------------------------------------------- */

export async function updatePet(auth: AuthContext, petId: string, input: UpdatePetInput) {
  const pet = await loadPetForActor(auth, petId);

  if (pet.status === PetStatus.ARCHIVED) {
    throw ApiError.conflict(ERROR_CODES.PET_ARCHIVED, 'Restore this pet before editing it.');
  }

  /**
   * Assigned field by field, never by spreading `input` onto the document.
   *
   * A spread would happily write any key the payload contained — including
   * `owner` or `status` — which is mass assignment. Zod has already stripped
   * unknown keys, but relying on that alone means one loosened schema becomes a
   * privilege-escalation bug.
   */
  if (input.name !== undefined) pet.name = input.name;
  if (input.species !== undefined) pet.species = input.species;
  if (input.breed !== undefined) pet.breed = input.breed;
  if (input.sex !== undefined) pet.sex = input.sex;
  if (input.dateOfBirth !== undefined) {
    pet.dateOfBirth = new Date(`${input.dateOfBirth}T00:00:00.000Z`);
  }
  if (input.isDateOfBirthApproximate !== undefined) {
    pet.isDateOfBirthApproximate = input.isDateOfBirthApproximate;
  }
  if (input.weightKg !== undefined) pet.weightKg = input.weightKg;
  if (input.color !== undefined) pet.color = input.color;
  if (input.microchipId !== undefined) pet.microchipId = input.microchipId || null;
  if (input.allergies !== undefined) pet.allergies = input.allergies;
  if (input.chronicConditions !== undefined) pet.chronicConditions = input.chronicConditions;
  if (input.currentMedications !== undefined) pet.currentMedications = input.currentMedications;
  if (input.isNeutered !== undefined) pet.isNeutered = input.isNeutered;
  if (input.isInsured !== undefined) pet.isInsured = input.isInsured;
  if (input.insuranceProvider !== undefined) pet.insuranceProvider = input.insuranceProvider;
  if (input.insurancePolicyNumber !== undefined) {
    pet.insurancePolicyNumber = input.insurancePolicyNumber;
  }
  if (input.emergencyNotes !== undefined) pet.emergencyNotes = input.emergencyNotes;

  await pet.save();
  return toPetDTO(pet);
}

/* -------------------------------------------------------------------------- */
/*                                   Archive                                  */
/* -------------------------------------------------------------------------- */

/**
 * Archive rather than delete.
 *
 * A hard delete would orphan appointments and destroy medical history that may
 * matter for an insurance claim or a later diagnosis. Archiving keeps the
 * record and takes the pet out of every list.
 */
export async function archivePet(
  auth: AuthContext,
  petId: string,
  options: { deceased?: boolean } = {},
) {
  const pet = await loadPetForActor(auth, petId);

  /* Refuse while appointments are still live, rather than silently stranding
     a doctor with a booking for an archived patient. */
  const upcoming = await Appointment.countDocuments({
    pet: pet._id,
    status: { $in: [...SLOT_BLOCKING_STATUSES] },
    slotStart: { $gte: new Date() },
  });

  if (upcoming > 0) {
    throw ApiError.conflict(
      ERROR_CODES.PET_HAS_ACTIVE_APPOINTMENTS,
      `Cancel this pet's ${upcoming} upcoming appointment${upcoming === 1 ? '' : 's'} first.`,
    );
  }

  pet.status = options.deceased ? PetStatus.DECEASED : PetStatus.ARCHIVED;
  await pet.save();

  /* Stop vaccination reminders — chasing an owner about a booster for a pet
     they have just lost is the worst possible email to send. */
  await Vaccination.updateMany(
    { pet: pet._id, status: VaccinationStatus.SCHEDULED },
    { $set: { status: VaccinationStatus.SKIPPED } },
  );

  return toPetDTO(pet);
}

export async function restorePet(auth: AuthContext, petId: string) {
  const pet = await loadPetForActor(auth, petId);

  if (pet.status === PetStatus.ACTIVE) {
    return toPetDTO(pet);
  }

  pet.status = PetStatus.ACTIVE;
  pet.deceasedAt = null;
  await pet.save();

  return toPetDTO(pet);
}

/**
 * Refresh the denormalised visit timestamps on a pet.
 *
 * Called by the appointment service whenever a booking changes, so the pet list
 * can show "next appointment" without a per-row query.
 */
export async function refreshPetTimeline(petId: Types.ObjectId): Promise<void> {
  const now = new Date();

  const [next, last] = await Promise.all([
    Appointment.findOne({
      pet: petId,
      status: { $in: [...SLOT_BLOCKING_STATUSES] },
      slotStart: { $gte: now },
    })
      .sort({ slotStart: 1 })
      .select('slotStart')
      .lean(),
    Appointment.findOne({
      pet: petId,
      status: AppointmentStatus.COMPLETED,
    })
      .sort({ slotStart: -1 })
      .select('slotStart')
      .lean(),
  ]);

  await Pet.updateOne(
    { _id: petId },
    {
      $set: {
        nextAppointmentAt: next?.slotStart ?? null,
        lastVisitAt: last?.slotStart ?? null,
      },
    },
  );
}
