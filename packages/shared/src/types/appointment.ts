import type {
  AppointmentStatus,
  AppointmentType,
  CancelledBy,
  PetSpecies,
} from '../enums.js';
import type {
  AppointmentId,
  ClinicId,
  DoctorId,
  ISODateString,
  MediaAsset,
  Money,
  PetId,
  Timestamps,
  UserId,
} from './common.js';

export interface Appointment extends Timestamps {
  id: AppointmentId;
  /** Short human-quotable reference, e.g. `PAW-8F3K2Q`. Support asks for this. */
  reference: string;
  clientId: UserId;
  petId: PetId;
  doctorId: DoctorId;
  clinicId: ClinicId;

  /**
   * The canonical slot. `slotStart` is the key half of the unique index that
   * prevents double-booking, so it is always snapped to the doctor's slot grid
   * before being written — never taken raw from client input.
   */
  slotStart: ISODateString;
  slotEnd: ISODateString;
  durationMinutes: number;

  type: AppointmentType;
  reason: string;
  clientNotes?: string;
  status: AppointmentStatus;
  fee: Money;

  /* Lifecycle timestamps — each written once, when the transition happens. */
  confirmedAt?: ISODateString;
  startedAt?: ISODateString;
  completedAt?: ISODateString;
  cancelledAt?: ISODateString;
  cancelledBy?: CancelledBy;
  cancellationReason?: string;

  /** Set when this appointment replaced an earlier one. */
  rescheduledFrom?: AppointmentId;
  rescheduledTo?: AppointmentId;

  remindersSent: ISODateString[];
  hasReview: boolean;
  hasMedicalRecord: boolean;
}

/**
 * An appointment joined with the denormalised fragments every list view needs.
 *
 * Returning this shape means a calendar of 200 appointments is one query with
 * three `$lookup`s, not 601 round trips. The embedded fragments are read-only
 * projections — the authoritative records live in their own collections.
 */
export interface AppointmentDetail extends Appointment {
  pet: AppointmentPetFragment;
  client: AppointmentPersonFragment;
  doctor: AppointmentDoctorFragment;
  /** Transitions the *calling* user may perform right now. Drives the UI buttons. */
  allowedTransitions: AppointmentStatus[];
  canCancel: boolean;
  canReschedule: boolean;
  canReview: boolean;
}

export interface AppointmentPetFragment {
  id: PetId;
  name: string;
  species: PetSpecies;
  breed?: string;
  photo?: MediaAsset;
}

export interface AppointmentPersonFragment {
  id: UserId;
  fullName: string;
  email: string;
  phone?: string;
  avatar?: MediaAsset;
}

export interface AppointmentDoctorFragment {
  id: DoctorId;
  userId: UserId;
  fullName: string;
  title: string;
  specializations: string[];
  avatar?: MediaAsset;
  rating: number;
}

/* -------------------------------------------------------------------------- */
/*                                  Payloads                                  */
/* -------------------------------------------------------------------------- */

export interface CreateAppointmentPayload {
  petId: PetId;
  doctorId: DoctorId;
  /** Must match a generated slot start exactly; the server re-validates. */
  slotStart: ISODateString;
  type: AppointmentType;
  reason: string;
  clientNotes?: string;
  /** Staff booking on behalf of a client. Ignored for client callers. */
  clientId?: UserId;
}

export interface RescheduleAppointmentPayload {
  slotStart: ISODateString;
  doctorId?: DoctorId;
  reason?: string;
}

export interface TransitionAppointmentPayload {
  status: AppointmentStatus;
  reason?: string;
}

export interface CancelAppointmentPayload {
  reason: string;
}

export interface AppointmentListQuery {
  page?: number;
  limit?: number;
  status?: AppointmentStatus | AppointmentStatus[];
  type?: AppointmentType;
  doctorId?: DoctorId;
  petId?: PetId;
  clientId?: UserId;
  clinicId?: ClinicId;
  /** Inclusive ISO date-time lower bound on `slotStart`. */
  from?: ISODateString;
  /** Exclusive ISO date-time upper bound on `slotStart`. */
  to?: ISODateString;
  search?: string;
  sort?: 'slotStart' | 'createdAt' | 'status';
  order?: 'asc' | 'desc';
}

/** Compact shape for the calendar grid — deliberately smaller than `AppointmentDetail`. */
export interface CalendarEntry {
  id: AppointmentId;
  reference: string;
  slotStart: ISODateString;
  slotEnd: ISODateString;
  status: AppointmentStatus;
  type: AppointmentType;
  petName: string;
  clientName: string;
  doctorName: string;
  doctorId: DoctorId;
}
