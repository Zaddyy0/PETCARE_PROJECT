/**
 * Medical records.
 *
 * Clinical notes can end up in an insurance claim or a negligence dispute, so
 * the history has to be defensible. Two rules follow from that:
 *
 *   • **No hard deletes.** There is no delete route for this collection.
 *   • **Edits become amendments.** A clinician may correct their notes freely
 *     for a short window; after that the record locks and every further change
 *     appends to `amendments`, preserving what the text said before.
 *
 * A record whose history can be silently rewritten is worth less than no
 * history at all.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  MEDICAL,
  MEDICAL_RECORD_TYPES,
  MedicalRecordType,
  type MedicalRecordType as MedicalRecordTypeType,
} from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface IPrescription {
  medication: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  route?: string;
  instructions?: string;
  startDate?: Date | null;
}

export interface IVitals {
  weightKg?: number;
  temperatureCelsius?: number;
  heartRateBpm?: number;
  respiratoryRateBpm?: number;
  bodyConditionScore?: number;
  hydrationStatus?: string;
}

export interface IRecordAmendment {
  amendedBy: Types.ObjectId;
  amendedAt: Date;
  reason: string;
  previousValues: Record<string, unknown>;
}

export interface IMedicalRecord {
  _id: Types.ObjectId;
  pet: Types.ObjectId;
  doctor: Types.ObjectId;
  clinic: Types.ObjectId;
  appointment?: Types.ObjectId | null;

  type: MedicalRecordTypeType;
  visitDate: Date;
  chiefComplaint: string;
  diagnosis: string;
  treatment: string;
  notes?: string;

  vitals?: IVitals | null;
  prescriptions: IPrescription[];
  attachments: { url: string; publicId: string; format?: string; bytes?: number }[];

  followUpRequired: boolean;
  followUpDate?: Date | null;
  followUpNotes?: string;

  amendments: IRecordAmendment[];
  lockedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export interface IMedicalRecordMethods {
  isEditable(now?: Date): boolean;
}

export type MedicalRecordDocument = HydratedDocument<IMedicalRecord, IMedicalRecordMethods>;
export type MedicalRecordModel = Model<IMedicalRecord, Record<string, never>, IMedicalRecordMethods>;

const prescriptionSchema = new Schema<IPrescription>(
  {
    medication: { type: String, required: true, trim: true, maxlength: 120 },
    dosage: { type: String, required: true, trim: true, maxlength: 60 },
    frequency: { type: String, required: true, trim: true, maxlength: 60 },
    durationDays: { type: Number, required: true, min: 1, max: 365 },
    route: { type: String, trim: true, maxlength: 40 },
    instructions: { type: String, trim: true, maxlength: 500 },
    startDate: { type: Date, default: null },
  },
  { _id: false },
);

const vitalsSchema = new Schema<IVitals>(
  {
    weightKg: { type: Number, min: 0, max: 1000 },
    temperatureCelsius: { type: Number, min: 20, max: 45 },
    heartRateBpm: { type: Number, min: 10, max: 400 },
    respiratoryRateBpm: { type: Number, min: 1, max: 200 },
    bodyConditionScore: { type: Number, min: 1, max: 9 },
    hydrationStatus: { type: String, trim: true, maxlength: 60 },
  },
  { _id: false },
);

const amendmentSchema = new Schema<IRecordAmendment>(
  {
    amendedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amendedAt: { type: Date, required: true, default: Date.now },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    /* `Mixed` because the shape mirrors whichever fields changed. */
    previousValues: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

const medicalRecordSchema = new Schema<
  IMedicalRecord,
  MedicalRecordModel,
  IMedicalRecordMethods
>(
  {
    pet: { type: Schema.Types.ObjectId, ref: 'Pet', required: true, index: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },
    appointment: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },

    type: {
      type: String,
      enum: MEDICAL_RECORD_TYPES,
      required: true,
      default: MedicalRecordType.CONSULTATION,
    },
    visitDate: { type: Date, required: true, default: Date.now },
    chiefComplaint: { type: String, required: true, trim: true, maxlength: 500 },
    diagnosis: { type: String, required: true, trim: true, maxlength: 2000 },
    treatment: { type: String, required: true, trim: true, maxlength: 2000 },
    notes: { type: String, trim: true, maxlength: 5000 },

    vitals: { type: vitalsSchema, default: null },
    prescriptions: { type: [prescriptionSchema], default: [] },
    attachments: {
      type: [
        new Schema(
          {
            url: { type: String, required: true },
            publicId: { type: String, required: true },
            format: String,
            bytes: Number,
          },
          { _id: false },
        ),
      ],
      default: [],
      validate: {
        validator: (value: unknown[]) => value.length <= MEDICAL.MAX_ATTACHMENTS_PER_RECORD,
        message: `At most ${MEDICAL.MAX_ATTACHMENTS_PER_RECORD} attachments per record`,
      },
    },

    followUpRequired: { type: Boolean, default: false },
    followUpDate: { type: Date, default: null },
    followUpNotes: { type: String, trim: true, maxlength: 1000 },

    amendments: { type: [amendmentSchema], default: [] },
    lockedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/* A pet's history, newest first — the timeline view. */
medicalRecordSchema.index({ pet: 1, visitDate: -1 });
medicalRecordSchema.index({ doctor: 1, visitDate: -1 });
medicalRecordSchema.index({ clinic: 1, visitDate: -1 });
/* Drives the follow-up reminder job. */
medicalRecordSchema.index(
  { followUpDate: 1 },
  { partialFilterExpression: { followUpRequired: true }, name: 'follow_up_scan' },
);
medicalRecordSchema.index(
  { diagnosis: 'text', treatment: 'text', chiefComplaint: 'text' },
  { name: 'record_search' },
);

/**
 * Is this record still inside its free-edit window?
 *
 * Past the window the record is locked and changes must go through the
 * amendment path. The service enforces this; the method is here so the API can
 * also *tell* the client, and the UI can show "amend" instead of "edit".
 */
medicalRecordSchema.methods['isEditable'] = function isEditable(
  this: MedicalRecordDocument,
  now: Date = new Date(),
): boolean {
  if (this.lockedAt) return false;
  const ageHours = (now.getTime() - this.createdAt.getTime()) / 3_600_000;
  return ageHours <= MEDICAL.FREE_EDIT_WINDOW_HOURS;
};

applyStandardTransform(medicalRecordSchema);

export const MedicalRecord = (mongoose.models['MedicalRecord'] as MedicalRecordModel) ??
  mongoose.model<IMedicalRecord, MedicalRecordModel>('MedicalRecord', medicalRecordSchema);
