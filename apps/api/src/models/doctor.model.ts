/**
 * Doctor profiles.
 *
 * Kept in a separate collection from `User` rather than as extra fields on it.
 * The `users` collection is read on essentially every authenticated request, so
 * it should stay small and cache-friendly; a doctor's bio, qualification list
 * and availability rules are large and read only when someone views or books
 * them. Splitting them keeps the hot path hot.
 *
 * The availability sub-document is the input to `generateSlots()` in
 * `@pawsitive/shared`. It stores *rules*, not materialised slots — see that
 * module's header for why.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { BOOKING, type DayOfWeek } from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface ITimeBlock {
  start: string;
  end: string;
}

export interface IWeeklyAvailability {
  dayOfWeek: DayOfWeek;
  blocks: ITimeBlock[];
}

export interface IAvailabilityOverride {
  date: string;
  isUnavailable: boolean;
  blocks: ITimeBlock[];
  reason?: string;
}

export interface IDoctorAvailability {
  timezone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  advanceBookingDays: number;
  minimumNoticeMinutes: number;
  weekly: IWeeklyAvailability[];
  overrides: IAvailabilityOverride[];
}

export interface IQualification {
  degree: string;
  institution: string;
  year: number;
}

export interface IDoctor {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  clinic: Types.ObjectId;

  title: string;
  bio: string;
  specializations: string[];
  qualifications: IQualification[];
  licenseNumber: string;
  licenseExpiresAt?: Date | null;
  yearsOfExperience: number;
  languages: string[];

  consultationFeeMinor: number;
  currency: string;

  availability: IDoctorAvailability;

  /**
   * Running rating aggregate.
   *
   * `sum` and `count` are incremented as reviews land, and `average` is derived
   * from them. Recomputing the mean over every review on each read is fine at a
   * hundred reviews and a problem at fifty thousand; an `$inc` is constant time
   * regardless. `distribution` backs the five-bar histogram without a second
   * aggregation.
   */
  ratingSum: number;
  ratingCount: number;
  ratingAverage: number;
  ratingDistribution: { 1: number; 2: number; 3: number; 4: number; 5: number };

  isAcceptingPatients: boolean;
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type DoctorDocument = HydratedDocument<IDoctor>;
export type DoctorModel = Model<IDoctor>;

const timeBlockSchema = new Schema<ITimeBlock>(
  {
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
    end: { type: String, required: true, match: /^([01]\d|2[0-3]):([0-5]\d)$/ },
  },
  { _id: false },
);

const weeklyAvailabilitySchema = new Schema<IWeeklyAvailability>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    blocks: { type: [timeBlockSchema], default: [] },
  },
  { _id: false },
);

const availabilityOverrideSchema = new Schema<IAvailabilityOverride>(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    isUnavailable: { type: Boolean, default: false },
    blocks: { type: [timeBlockSchema], default: [] },
    reason: { type: String, maxlength: 200 },
  },
  { _id: false },
);

const qualificationSchema = new Schema<IQualification>(
  {
    degree: { type: String, required: true, trim: true, maxlength: 120 },
    institution: { type: String, required: true, trim: true, maxlength: 160 },
    year: { type: Number, required: true, min: 1900, max: 2200 },
  },
  { _id: false },
);

/** Mon–Fri 09:00–13:00 and 14:00–17:00; weekends off. */
function defaultWeeklyAvailability(): IWeeklyAvailability[] {
  const workday: ITimeBlock[] = [
    { start: '09:00', end: '13:00' },
    { start: '14:00', end: '17:00' },
  ];

  return ([0, 1, 2, 3, 4, 5, 6] as DayOfWeek[]).map((dayOfWeek) => ({
    dayOfWeek,
    blocks: dayOfWeek === 0 || dayOfWeek === 6 ? [] : workday,
  }));
}

const doctorSchema = new Schema<IDoctor, DoctorModel>(
  {
    /* One profile per user account. */
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 60, default: 'Veterinarian' },
    bio: { type: String, default: '', trim: true, maxlength: 2000 },
    specializations: { type: [String], default: [], index: true },
    qualifications: { type: [qualificationSchema], default: [] },
    licenseNumber: { type: String, required: true, trim: true, maxlength: 60 },
    licenseExpiresAt: { type: Date, default: null },
    yearsOfExperience: { type: Number, default: 0, min: 0, max: 70 },
    languages: { type: [String], default: ['English'] },

    consultationFeeMinor: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR', uppercase: true, maxlength: 3 },

    availability: {
      timezone: { type: String, default: 'Asia/Kolkata', maxlength: 64 },
      slotDurationMinutes: {
        type: Number,
        default: BOOKING.DEFAULT_SLOT_MINUTES,
        /* Divisors of 60 only, so the grid stays aligned to the hour. */
        enum: [10, 15, 20, 30, 60],
      },
      bufferMinutes: { type: Number, default: BOOKING.DEFAULT_BUFFER_MINUTES, min: 0, max: 60 },
      advanceBookingDays: {
        type: Number,
        default: BOOKING.DEFAULT_ADVANCE_DAYS,
        min: 1,
        max: 365,
      },
      minimumNoticeMinutes: {
        type: Number,
        default: BOOKING.DEFAULT_MIN_NOTICE_MINUTES,
        min: 0,
        max: 10_080,
      },
      weekly: { type: [weeklyAvailabilitySchema], default: defaultWeeklyAvailability },
      overrides: { type: [availabilityOverrideSchema], default: [] },
    },

    ratingSum: { type: Number, default: 0, min: 0 },
    ratingCount: { type: Number, default: 0, min: 0 },
    ratingAverage: { type: Number, default: 0, min: 0, max: 5, index: true },
    ratingDistribution: {
      1: { type: Number, default: 0, min: 0 },
      2: { type: Number, default: 0, min: 0 },
      3: { type: Number, default: 0, min: 0 },
      4: { type: Number, default: 0, min: 0 },
      5: { type: Number, default: 0, min: 0 },
    },

    isAcceptingPatients: { type: Boolean, default: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, minimize: false },
);

/* The doctor-directory query: active, accepting, sorted by rating. */
doctorSchema.index({ clinic: 1, isActive: 1, isAcceptingPatients: 1, ratingAverage: -1 });
doctorSchema.index({ specializations: 1, ratingAverage: -1 });
doctorSchema.index({ licenseNumber: 1, clinic: 1 }, { unique: true, name: 'uniq_license_clinic' });

/**
 * Keep `ratingAverage` consistent with its inputs.
 *
 * Derived on save rather than trusted from the caller, so the sortable field
 * can never disagree with the sum and count it is supposed to summarise.
 */
doctorSchema.pre('save', function deriveRatingAverage(next) {
  if (this.isModified('ratingSum') || this.isModified('ratingCount')) {
    this.ratingAverage =
      this.ratingCount > 0 ? Math.round((this.ratingSum / this.ratingCount) * 100) / 100 : 0;
  }
  next();
});

applyStandardTransform(doctorSchema);

export const Doctor = (mongoose.models['Doctor'] as DoctorModel) ??
  mongoose.model<IDoctor>('Doctor', doctorSchema);

export { defaultWeeklyAvailability };
