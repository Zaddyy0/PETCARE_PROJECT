/**
 * Pets.
 *
 * Two changes from the previous model are worth calling out:
 *
 *   • **Date of birth, not age.** The old schema stored `age: Number`. An age
 *     integer is wrong the day after it is written, and because nothing records
 *     *when* it was written there is no way to correct it — a pet entered as
 *     "2" stays 2 forever. Storing the birth date makes age a derived value
 *     that is always right.
 *
 *   • **Archive, never delete.** Deleting a pet would orphan its appointments
 *     and destroy medical history that may be needed for an insurance claim or
 *     a later diagnosis. `status` moves to `archived` instead, and every listing
 *     query filters on it.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  PET_SEXES,
  PET_SPECIES,
  PET_STATUSES,
  PetSex,
  PetStatus,
  type PetSex as PetSexType,
  type PetSpecies as PetSpeciesType,
  type PetStatus as PetStatusType,
} from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface IPet {
  _id: Types.ObjectId;
  owner: Types.ObjectId;

  name: string;
  species: PetSpeciesType;
  breed?: string;
  sex: PetSexType;

  dateOfBirth?: Date | null;
  isDateOfBirthApproximate: boolean;

  weightKg?: number | null;
  color?: string;
  microchipId?: string | null;

  photo?: {
    url: string;
    publicId: string;
    thumbnailUrl?: string;
  } | null;

  allergies: string[];
  chronicConditions: string[];
  currentMedications: string[];

  isNeutered: boolean;
  isInsured: boolean;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  emergencyNotes?: string;

  status: PetStatusType;
  archivedAt?: Date | null;
  deceasedAt?: Date | null;

  /**
   * Denormalised for list views. Maintained by the appointment service so a
   * grid of pet cards does not need one appointment query per card.
   */
  lastVisitAt?: Date | null;
  nextAppointmentAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export type PetDocument = HydratedDocument<IPet>;
export type PetModel = Model<IPet>;

const petSchema = new Schema<IPet, PetModel>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 40 },
    species: { type: String, enum: PET_SPECIES, required: true, index: true },
    breed: { type: String, trim: true, maxlength: 60 },
    sex: { type: String, enum: PET_SEXES, default: PetSex.UNKNOWN },

    dateOfBirth: { type: Date, default: null },
    isDateOfBirthApproximate: { type: Boolean, default: false },

    weightKg: { type: Number, default: null, min: 0, max: 1000 },
    color: { type: String, trim: true, maxlength: 40 },
    microchipId: { type: String, trim: true, maxlength: 20, default: null },

    photo: {
      type: new Schema(
        {
          url: { type: String, required: true },
          publicId: { type: String, required: true },
          thumbnailUrl: String,
        },
        { _id: false },
      ),
      default: null,
    },

    allergies: { type: [String], default: [] },
    chronicConditions: { type: [String], default: [] },
    currentMedications: { type: [String], default: [] },

    isNeutered: { type: Boolean, default: false },
    isInsured: { type: Boolean, default: false },
    insuranceProvider: { type: String, trim: true, maxlength: 80 },
    insurancePolicyNumber: { type: String, trim: true, maxlength: 60 },
    emergencyNotes: { type: String, trim: true, maxlength: 1000 },

    status: { type: String, enum: PET_STATUSES, default: PetStatus.ACTIVE, index: true },
    archivedAt: { type: Date, default: null },
    deceasedAt: { type: Date, default: null },

    lastVisitAt: { type: Date, default: null },
    nextAppointmentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/* The client's own pet list — by far the most common pet query. */
petSchema.index({ owner: 1, status: 1, createdAt: -1 });
petSchema.index({ owner: 1, name: 1 });
petSchema.index({ species: 1, status: 1 });

/**
 * A microchip number identifies exactly one animal worldwide, so duplicates are
 * a data-entry error worth catching.
 *
 * **Partial, not sparse.** `microchipId` declares `default: null`, and a sparse
 * index only skips *missing* fields — an explicit null is a present value and
 * gets indexed. With `sparse: true` the second chip-less pet on the platform
 * would fail to save with a duplicate-key error on `null`.
 */
petSchema.index(
  { microchipId: 1 },
  {
    unique: true,
    partialFilterExpression: { microchipId: { $type: 'string' } },
    name: 'uniq_microchip',
  },
);

petSchema.index({ name: 'text', breed: 'text' }, { name: 'pet_search' });

/** Keep the archive timestamps consistent with the status they describe. */
petSchema.pre('save', function syncArchiveTimestamps(next) {
  if (this.isModified('status')) {
    if (this.status === PetStatus.ARCHIVED && !this.archivedAt) {
      this.archivedAt = new Date();
    }
    if (this.status === PetStatus.DECEASED && !this.deceasedAt) {
      this.deceasedAt = new Date();
    }
    if (this.status === PetStatus.ACTIVE) {
      this.archivedAt = null;
    }
  }
  next();
});

/**
 * Normalise an empty microchip to `null` rather than `''`.
 *
 * The sparse unique index skips missing and null values but *not* empty
 * strings — so two pets saved with `microchipId: ''` would collide and the
 * second save would fail with a confusing duplicate-key error.
 */
petSchema.pre('save', function normaliseMicrochip(next) {
  if (this.microchipId !== undefined && !this.microchipId) {
    this.microchipId = null;
  }
  next();
});

applyStandardTransform(petSchema);

export const Pet = (mongoose.models['Pet'] as PetModel) ??
  mongoose.model<IPet>('Pet', petSchema);
