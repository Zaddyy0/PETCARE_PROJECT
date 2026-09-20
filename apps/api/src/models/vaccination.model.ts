/**
 * Vaccinations.
 *
 * One document per *dose*, not one per vaccine with an array of dates. A dose
 * is the unit that gets scheduled, reminded about, marked overdue and reported
 * on — modelling it as the document makes each of those a plain query instead
 * of an array projection.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  VACCINATION_STATUSES,
  VaccinationStatus,
  type VaccinationStatus as VaccinationStatusType,
} from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface IVaccination {
  _id: Types.ObjectId;
  pet: Types.ObjectId;
  /** Null while a dose is scheduled but no clinician is assigned yet. */
  doctor?: Types.ObjectId | null;
  clinic: Types.ObjectId;
  medicalRecord?: Types.ObjectId | null;

  vaccineName: string;
  manufacturer?: string;
  batchNumber?: string;
  doseNumber: number;
  totalDoses?: number | null;

  status: VaccinationStatusType;
  administeredAt?: Date | null;
  dueAt: Date;
  notes?: string;
  reminderSent: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type VaccinationDocument = HydratedDocument<IVaccination>;
export type VaccinationModel = Model<IVaccination>;

const vaccinationSchema = new Schema<IVaccination, VaccinationModel>(
  {
    pet: { type: Schema.Types.ObjectId, ref: 'Pet', required: true, index: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', default: null },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    medicalRecord: { type: Schema.Types.ObjectId, ref: 'MedicalRecord', default: null },

    vaccineName: { type: String, required: true, trim: true, maxlength: 120 },
    manufacturer: { type: String, trim: true, maxlength: 120 },
    batchNumber: { type: String, trim: true, maxlength: 60 },
    doseNumber: { type: Number, required: true, default: 1, min: 1, max: 20 },
    totalDoses: { type: Number, default: null, min: 1, max: 20 },

    status: {
      type: String,
      enum: VACCINATION_STATUSES,
      default: VaccinationStatus.SCHEDULED,
      index: true,
    },
    administeredAt: { type: Date, default: null },
    dueAt: { type: Date, required: true },
    notes: { type: String, trim: true, maxlength: 1000 },
    reminderSent: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/* A pet's vaccination card. */
vaccinationSchema.index({ pet: 1, dueAt: -1 });
vaccinationSchema.index({ pet: 1, status: 1, dueAt: 1 });

/**
 * Backs both the nightly overdue sweep and the reminder job.
 *
 * Partial on `status: 'scheduled'` so the index covers only doses that can
 * still change state — administered history, which is the bulk of the
 * collection and grows forever, stays out of it.
 */
vaccinationSchema.index(
  { dueAt: 1, reminderSent: 1 },
  {
    partialFilterExpression: { status: VaccinationStatus.SCHEDULED },
    name: 'vaccination_due_scan',
  },
);

vaccinationSchema.index({ clinic: 1, dueAt: 1 });

/** A given dose of a given vaccine is recorded once per pet. */
vaccinationSchema.index(
  { pet: 1, vaccineName: 1, doseNumber: 1 },
  { unique: true, name: 'uniq_pet_vaccine_dose' },
);

/**
 * Recording an administration date settles the status.
 *
 * Without this a dose could be marked given while still sitting in the
 * `scheduled` bucket that the reminder job scans — and the owner would be
 * nagged about a shot their pet already had.
 */
vaccinationSchema.pre('save', function syncStatus(next) {
  if (this.isModified('administeredAt') && this.administeredAt) {
    this.status = VaccinationStatus.ADMINISTERED;
  }
  next();
});

applyStandardTransform(vaccinationSchema);

export const Vaccination = (mongoose.models['Vaccination'] as VaccinationModel) ??
  mongoose.model<IVaccination>('Vaccination', vaccinationSchema);
