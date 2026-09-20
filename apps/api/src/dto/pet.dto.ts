import type { Types } from 'mongoose';
import {
  petAgeInMonths,
  petAgeLabel,
  type MediaAsset,
  type Pet as PetDTO,
  type PetWithSummary,
} from '@pawsitive/shared';
import type { IPet } from '../models/pet.model.js';

type PetLike = IPet & { _id: Types.ObjectId };

/**
 * Dates are emitted as `YYYY-MM-DD`, not as a full ISO timestamp.
 *
 * A birth date is a calendar fact, not an instant. Sending
 * `2024-03-15T00:00:00.000Z` means a client in UTC-5 renders it as 14 March —
 * the pet appears to have been born a day earlier for half the world.
 */
function toDateOnly(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString().slice(0, 10) : undefined;
}

export function toPetDTO(pet: PetLike): PetDTO {
  const dto: PetDTO = {
    id: pet._id.toString(),
    ownerId: pet.owner.toString(),
    name: pet.name,
    species: pet.species,
    sex: pet.sex,
    isDateOfBirthApproximate: pet.isDateOfBirthApproximate,
    allergies: [...pet.allergies],
    chronicConditions: [...pet.chronicConditions],
    currentMedications: [...pet.currentMedications],
    isNeutered: pet.isNeutered,
    isInsured: pet.isInsured,
    status: pet.status,
    createdAt: pet.createdAt.toISOString(),
    updatedAt: pet.updatedAt.toISOString(),
  };

  const dateOfBirth = toDateOnly(pet.dateOfBirth);
  if (dateOfBirth) dto.dateOfBirth = dateOfBirth;

  if (pet.breed) dto.breed = pet.breed;
  if (pet.weightKg != null) dto.weightKg = pet.weightKg;
  if (pet.color) dto.color = pet.color;
  if (pet.microchipId) dto.microchipId = pet.microchipId;
  if (pet.insuranceProvider) dto.insuranceProvider = pet.insuranceProvider;
  if (pet.insurancePolicyNumber) dto.insurancePolicyNumber = pet.insurancePolicyNumber;
  if (pet.emergencyNotes) dto.emergencyNotes = pet.emergencyNotes;
  if (pet.deceasedAt) dto.deceasedAt = pet.deceasedAt.toISOString();

  if (pet.photo) {
    const photo: MediaAsset = { url: pet.photo.url, publicId: pet.photo.publicId };
    if (pet.photo.thumbnailUrl) photo.thumbnailUrl = pet.photo.thumbnailUrl;
    dto.photo = photo;
  }

  return dto;
}

export interface PetSummaryExtras {
  upcomingAppointmentCount?: number;
  overdueVaccinationCount?: number;
  ownerName?: string;
}

/**
 * A pet plus the derived fields list views render.
 *
 * Age is computed here rather than stored, which is why the model keeps a birth
 * date: a stored age integer is wrong the day after it is written and there is
 * no record of when that was.
 */
export function toPetSummaryDTO(pet: PetLike, extras: PetSummaryExtras = {}): PetWithSummary {
  const base = toPetDTO(pet);
  const dateOfBirth = base.dateOfBirth ?? null;

  const summary: PetWithSummary = {
    ...base,
    ageMonths: petAgeInMonths(dateOfBirth),
    ageLabel: petAgeLabel(dateOfBirth),
    upcomingAppointmentCount: extras.upcomingAppointmentCount ?? 0,
    nextAppointmentAt: pet.nextAppointmentAt ? pet.nextAppointmentAt.toISOString() : null,
    lastVisitAt: pet.lastVisitAt ? pet.lastVisitAt.toISOString() : null,
    overdueVaccinationCount: extras.overdueVaccinationCount ?? 0,
  };

  if (extras.ownerName) summary.ownerName = extras.ownerName;

  return summary;
}
