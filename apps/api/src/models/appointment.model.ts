/**
 * Appointments.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  THE DOUBLE-BOOKING PROBLEM
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The previous system had nothing preventing two clients from booking the same
 * doctor at the same moment. The obvious fix — "check whether the slot is free,
 * then insert" — does not work, and it is worth being precise about why:
 *
 *     Request A                     Request B
 *     ─────────                     ─────────
 *     find({doctor, 10:00}) → none
 *                                   find({doctor, 10:00}) → none
 *     insert(10:00)  ✓
 *                                   insert(10:00)  ✓   ← both succeeded
 *
 * Both reads happen before either write. No amount of application-level
 * checking closes that window, because the window is *between* the check and
 * the write. Retrying, locking in JavaScript, or re-reading after writing all
 * fail the same way as soon as there is more than one server process — and at
 * 1k users there will be.
 *
 * The only correct place to settle this is the database, which can make the
 * check and the write a single atomic operation. A unique index does exactly
 * that: the second insert fails with duplicate-key error E11000, deterministically,
 * no matter how many processes race.
 *
 *     appointment.service.ts catches E11000 and returns 409
 *     APPOINTMENT_SLOT_TAKEN, which the client turns into "that time was just
 *     taken" plus a refreshed slot grid.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *  WHY `blocksSlot` EXISTS
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A plain unique index on `{doctor, slotStart}` would be wrong: it would also
 * block re-booking a slot whose appointment was *cancelled*, permanently
 * burning that time. We only want uniqueness across appointments that actually
 * occupy the calendar.
 *
 * MongoDB's `partialFilterExpression` can scope an index to a subset of
 * documents — but it supports only a restricted grammar: `$eq`, `$exists`,
 * `$gt`/`$gte`/`$lt`/`$lte`, `$type` and `$and`. Notably **not** `$in`, so
 * `{status: {$in: [...]}}` is rejected outright.
 *
 * So we maintain a derived boolean, `blocksSlot`, which is true exactly when
 * `status` is one of the slot-occupying states, and scope the index to
 * `{blocksSlot: true}` — an `$eq`, which the grammar does allow. The field is
 * kept in sync by the hooks below rather than by callers, so it cannot drift.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  AppointmentStatus,
  CANCELLED_BY,
  SLOT_BLOCKING_STATUSES,
  generateAppointmentReference,
  type AppointmentStatus as AppointmentStatusType,
  type AppointmentType as AppointmentTypeType,
  type CancelledBy,
} from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface IAppointment {
  _id: Types.ObjectId;
  reference: string;

  client: Types.ObjectId;
  pet: Types.ObjectId;
  doctor: Types.ObjectId;
  clinic: Types.ObjectId;

  slotStart: Date;
  slotEnd: Date;
  durationMinutes: number;

  type: AppointmentTypeType;
  reason: string;
  clientNotes?: string;
  status: AppointmentStatusType;

  /**
   * Derived from `status`. Never set this by hand — the hooks below own it.
   * See the header comment for why it exists at all.
   */
  blocksSlot: boolean;

  feeAmountMinor: number;
  feeCurrency: string;

  confirmedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledBy?: CancelledBy | null;
  cancellationReason?: string | null;

  rescheduledFrom?: Types.ObjectId | null;
  rescheduledTo?: Types.ObjectId | null;

  remindersSent: Date[];
  hasReview: boolean;
  hasMedicalRecord: boolean;

  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type AppointmentDocument = HydratedDocument<IAppointment>;
export type AppointmentModel = Model<IAppointment>;

const appointmentSchema = new Schema<IAppointment, AppointmentModel>(
  {
    reference: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      /* Generated here rather than by the caller, so it always exists. */
      default: () => generateAppointmentReference(),
    },

    client: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pet: { type: Schema.Types.ObjectId, ref: 'Pet', required: true, index: true },
    doctor: { type: Schema.Types.ObjectId, ref: 'Doctor', required: true, index: true },
    clinic: { type: Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },

    /**
     * The canonical slot boundary.
     *
     * Always snapped to the doctor's generated grid by the service before it
     * reaches here — never taken verbatim from a request. An unsnapped value
     * would sidestep the unique index entirely: 10:00 and 10:00:01 are
     * different keys, so both would be accepted for the same half hour.
     */
    slotStart: { type: Date, required: true },
    slotEnd: { type: Date, required: true },
    durationMinutes: { type: Number, required: true, min: 5, max: 480 },

    type: { type: String, enum: APPOINTMENT_TYPES, required: true },
    reason: { type: String, required: true, trim: true, maxlength: 200 },
    clientNotes: { type: String, trim: true, maxlength: 1000 },

    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      required: true,
      default: AppointmentStatus.PENDING,
      index: true,
    },

    blocksSlot: { type: Boolean, required: true, default: true },

    feeAmountMinor: { type: Number, required: true, min: 0, default: 0 },
    feeCurrency: { type: String, required: true, default: 'INR', uppercase: true, maxlength: 3 },

    confirmedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: String, enum: [...CANCELLED_BY, null], default: null },
    cancellationReason: { type: String, default: null, maxlength: 300 },

    rescheduledFrom: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },
    rescheduledTo: { type: Schema.Types.ObjectId, ref: 'Appointment', default: null },

    remindersSent: { type: [Date], default: [] },
    hasReview: { type: Boolean, default: false },
    hasMedicalRecord: { type: Boolean, default: false },

    /** Who created it — a client self-booking, or staff booking on their behalf. */
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

/* -------------------------------------------------------------------------- */
/*                        THE DOUBLE-BOOKING GUARANTEE                        */
/* -------------------------------------------------------------------------- */

/**
 * One doctor cannot hold two occupying appointments at the same instant.
 *
 * This single index is the entire concurrency story. It is enforced by the
 * storage engine, so it holds across any number of Node processes, across a
 * deploy that briefly runs two versions at once, and against a caller hitting
 * the endpoint twice from a double-clicked button.
 *
 * Scoped to `blocksSlot: true` so a cancelled appointment releases its slot.
 */
appointmentSchema.index(
  { doctor: 1, slotStart: 1 },
  {
    unique: true,
    partialFilterExpression: { blocksSlot: true },
    name: 'uniq_doctor_slot_active',
  },
);

/**
 * The same guarantee for the *pet*.
 *
 * A pet cannot be in two consulting rooms at once. Less obvious than the doctor
 * case and just as real — without it, a client can book the same pet with two
 * different doctors at the same time and one of those appointments is
 * guaranteed to be a no-show.
 */
appointmentSchema.index(
  { pet: 1, slotStart: 1 },
  {
    unique: true,
    partialFilterExpression: { blocksSlot: true },
    name: 'uniq_pet_slot_active',
  },
);

/* ---------------------------- Query indexes ------------------------------- */

/* The doctor's calendar: "my appointments in this window", the single hottest
   query in the product. */
appointmentSchema.index({ doctor: 1, slotStart: 1, status: 1 });

/* A client's appointment list, newest first. */
appointmentSchema.index({ client: 1, slotStart: -1 });

/* A pet's visit history. */
appointmentSchema.index({ pet: 1, slotStart: -1 });

/* The clinic-wide admin calendar and its status filters. */
appointmentSchema.index({ clinic: 1, slotStart: 1, status: 1 });

/* Drives the reminder job: upcoming, still-active appointments. Partial, so
   the index stays small — it holds only future work, not years of history. */
appointmentSchema.index(
  { slotStart: 1 },
  { partialFilterExpression: { blocksSlot: true }, name: 'reminder_scan' },
);

/* -------------------------------------------------------------------------- */
/*                          Derived-field maintenance                         */
/* -------------------------------------------------------------------------- */

/**
 * Keep `blocksSlot` consistent with `status` on every document save.
 *
 * This is the invariant the unique index depends on. If it ever drifts, either
 * a cancelled slot stays unbookable or — worse — a live appointment stops
 * protecting its slot and a double-booking slips through.
 */
appointmentSchema.pre('save', function syncBlocksSlot(next) {
  if (this.isModified('status') || this.isNew) {
    this.blocksSlot = SLOT_BLOCKING_STATUSES.includes(this.status);
  }
  next();
});

/**
 * The same invariant for update operations, which bypass `pre('save')`.
 *
 * `findOneAndUpdate({status: 'cancelled'})` would otherwise leave `blocksSlot`
 * true and keep the slot locked forever. Services are expected to set both
 * fields explicitly, but relying on every future call site to remember is how
 * invariants rot — so we enforce it here as well.
 */
function syncBlocksSlotOnUpdate(this: mongoose.Query<unknown, IAppointment>, next: () => void) {
  const update = this.getUpdate() as Record<string, unknown> | null;
  if (!update) return next();

  const $set = (update['$set'] ?? {}) as Record<string, unknown>;
  const nextStatus = ($set['status'] ?? update['status']) as AppointmentStatusType | undefined;

  if (nextStatus) {
    const blocks = SLOT_BLOCKING_STATUSES.includes(nextStatus);
    this.setUpdate({ ...update, $set: { ...$set, blocksSlot: blocks } });
  }

  next();
}

appointmentSchema.pre('findOneAndUpdate', syncBlocksSlotOnUpdate);
appointmentSchema.pre('updateOne', syncBlocksSlotOnUpdate);
appointmentSchema.pre('updateMany', syncBlocksSlotOnUpdate);

/**
 * Derive `slotEnd` so it can never contradict `slotStart` + `durationMinutes`.
 *
 * Storing both a start and an end invites them to disagree. We keep the end
 * because calendar range queries need it, but compute it rather than trust it.
 */
appointmentSchema.pre('validate', function deriveSlotEnd(next) {
  if (this.slotStart && this.durationMinutes) {
    this.slotEnd = new Date(this.slotStart.getTime() + this.durationMinutes * 60_000);
  }
  next();
});

/* -------------------------------------------------------------------------- */
/*                                Serialisation                               */
/* -------------------------------------------------------------------------- */

/* `blocksSlot` is an internal invariant, not part of the public contract. */
applyStandardTransform(appointmentSchema, { omit: ['blocksSlot'] });

export const Appointment = (mongoose.models['Appointment'] as AppointmentModel) ??
  mongoose.model<IAppointment>('Appointment', appointmentSchema);

/**
 * Is this error the unique-index violation we care about?
 *
 * Both slot indexes surface as E11000. We distinguish them by name so the
 * service can tell "the doctor is busy" from "the pet is already booked" — two
 * very different messages for the user.
 */
export function isSlotConflictError(error: unknown): 'doctor' | 'pet' | null {
  if (!error || typeof error !== 'object') return null;

  const candidate = error as { code?: number; message?: string };
  if (candidate.code !== 11000) return null;

  const message = candidate.message ?? '';
  if (message.includes('uniq_doctor_slot_active')) return 'doctor';
  if (message.includes('uniq_pet_slot_active')) return 'pet';

  return null;
}
