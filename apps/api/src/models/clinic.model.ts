/**
 * Clinics.
 *
 * The clinic is the tenancy boundary. A doctor belongs to one, an admin manages
 * one, and almost every scoped query in the platform filters on it. Introducing
 * it now — rather than bolting multi-tenancy on later — is what lets a single
 * deployment serve several practices without one ever seeing another's patient
 * list.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { slugify } from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface IClinic {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  email: string;
  phone: string;

  address: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };

  /** GeoJSON, `[longitude, latitude]`. Optional until a clinic is geocoded. */
  location?: { type: 'Point'; coordinates: [number, number] } | null;

  logo?: { url: string; publicId: string } | null;
  coverImage?: { url: string; publicId: string } | null;

  timezone: string;
  currency: string;
  isActive: boolean;

  /**
   * Denormalised counters.
   *
   * Maintained with `$inc` on write so a dashboard tile is a single document
   * read rather than three `countDocuments` calls over growing collections.
   * They are a cache: a nightly job reconciles them, and nothing that must be
   * exact (billing, access control) reads from here.
   */
  stats: {
    doctorCount: number;
    clientCount: number;
    appointmentCount: number;
  };

  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ClinicDocument = HydratedDocument<IClinic>;
export type ClinicModel = Model<IClinic>;

/** GeoJSON Point. `coordinates` is `[longitude, latitude]`, in that order. */
const geoPointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], required: true, default: 'Point' },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) =>
          value.length === 2 &&
          typeof value[0] === 'number' &&
          typeof value[1] === 'number' &&
          value[0] >= -180 &&
          value[0] <= 180 &&
          value[1] >= -90 &&
          value[1] <= 90,
        /* Longitude first is the single most common GeoJSON mistake, and it
           silently places clinics in the wrong hemisphere rather than erroring. */
        message: 'Coordinates must be [longitude, latitude] within valid ranges',
      },
    },
  },
  { _id: false },
);

const clinicSchema = new Schema<IClinic, ClinicModel>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 2000 },
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },

    address: {
      line1: { type: String, required: true, trim: true, maxlength: 120 },
      line2: { type: String, trim: true, maxlength: 120 },
      city: { type: String, required: true, trim: true, maxlength: 80 },
      state: { type: String, required: true, trim: true, maxlength: 80 },
      postalCode: { type: String, required: true, trim: true, maxlength: 16 },
      country: { type: String, required: true, trim: true, maxlength: 60 },
    },

    /**
     * Declared as a named sub-schema rather than an inline nested object.
     *
     * Written inline, Mongoose reads the sibling `default: null` as a *subpath*
     * named `location.default` — because the inner `type:` key has already been
     * consumed as GeoJSON's own `type` field, so the outer object is no longer
     * recognised as a type declaration. It then rejects `null` as a schema
     * definition at startup. A `Schema` instance is unambiguous.
     */
    location: { type: geoPointSchema, default: null },

    logo: {
      type: new Schema({ url: String, publicId: String }, { _id: false }),
      default: null,
    },
    coverImage: {
      type: new Schema({ url: String, publicId: String }, { _id: false }),
      default: null,
    },

    timezone: { type: String, required: true, default: 'Asia/Kolkata', maxlength: 64 },
    currency: { type: String, required: true, default: 'INR', uppercase: true, maxlength: 3 },
    isActive: { type: Boolean, default: true, index: true },

    stats: {
      doctorCount: { type: Number, default: 0, min: 0 },
      clientCount: { type: Number, default: 0, min: 0 },
      appointmentCount: { type: Number, default: 0, min: 0 },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, minimize: false },
);

clinicSchema.index({ name: 'text', 'address.city': 'text' }, { name: 'clinic_search' });
/* `2dsphere` powers "clinics near me". Sparse, since `location` is nullable. */
clinicSchema.index({ location: '2dsphere' }, { sparse: true });

/**
 * Derive a unique slug from the name.
 *
 * Collisions are resolved with a short random suffix rather than a counter: a
 * counter needs a read-then-write, which two concurrent creates would both pass
 * — the same race the appointment index exists to prevent, in miniature.
 */
clinicSchema.pre('validate', function deriveSlug(next) {
  if (!this.slug && this.name) {
    const base = slugify(this.name);
    this.slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }
  next();
});

applyStandardTransform(clinicSchema);

export const Clinic = (mongoose.models['Clinic'] as ClinicModel) ??
  mongoose.model<IClinic>('Clinic', clinicSchema);
