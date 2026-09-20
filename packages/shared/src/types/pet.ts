import type { PetSex, PetSpecies, PetStatus } from '../enums.js';
import type {
  DateOnlyString,
  ISODateString,
  MediaAsset,
  PetId,
  Timestamps,
  UserId,
} from './common.js';

export interface Pet extends Timestamps {
  id: PetId;
  ownerId: UserId;
  name: string;
  species: PetSpecies;
  /** Free text: breed vocabularies are enormous and regional. */
  breed?: string;
  sex: PetSex;
  /**
   * Stored as a date of birth, never as an age.
   *
   * An age integer is wrong the day after it is written and there is no way to
   * correct it without knowing when it was recorded. Age is derived on read.
   */
  dateOfBirth?: DateOnlyString;
  /** True when the owner knows only an approximate age. */
  isDateOfBirthApproximate: boolean;
  weightKg?: number;
  color?: string;
  microchipId?: string;
  photo?: MediaAsset;
  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];
  isNeutered: boolean;
  isInsured: boolean;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  emergencyNotes?: string;
  status: PetStatus;
  deceasedAt?: ISODateString;
}

/** A pet with the derived and joined fields the UI actually renders. */
export interface PetWithSummary extends Pet {
  /** Derived from `dateOfBirth` at read time. `null` when unknown. */
  ageMonths: number | null;
  ageLabel: string;
  upcomingAppointmentCount: number;
  nextAppointmentAt: ISODateString | null;
  lastVisitAt: ISODateString | null;
  overdueVaccinationCount: number;
  ownerName?: string;
}

export interface CreatePetPayload {
  name: string;
  species: PetSpecies;
  breed?: string;
  sex: PetSex;
  dateOfBirth?: DateOnlyString;
  isDateOfBirthApproximate?: boolean;
  weightKg?: number;
  color?: string;
  microchipId?: string;
  allergies?: string[];
  chronicConditions?: string[];
  currentMedications?: string[];
  isNeutered?: boolean;
  isInsured?: boolean;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  emergencyNotes?: string;
  /** Admins and super admins may create a pet on another user's behalf. */
  ownerId?: UserId;
}

export type UpdatePetPayload = Partial<Omit<CreatePetPayload, 'ownerId'>>;

export interface PetListQuery {
  page?: number;
  limit?: number;
  search?: string;
  species?: PetSpecies;
  status?: PetStatus;
  ownerId?: UserId;
  sort?: 'createdAt' | 'name' | 'nextAppointmentAt';
  order?: 'asc' | 'desc';
}
