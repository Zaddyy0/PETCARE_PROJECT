import type { MedicalRecordType, VaccinationStatus } from '../enums.js';
import type {
  AppointmentId,
  ClinicId,
  DateOnlyString,
  DoctorId,
  ISODateString,
  MediaAsset,
  MedicalRecordId,
  PetId,
  Timestamps,
  UserId,
} from './common.js';

/* -------------------------------------------------------------------------- */
/*                               Medical record                               */
/* -------------------------------------------------------------------------- */

/**
 * A clinical entry against a pet.
 *
 * Medical records are **append-only in spirit**: they are never hard-deleted,
 * and an edit after the amendment window keeps the prior text in `amendments`.
 * Clinical notes can end up in an insurance dispute or a malpractice claim, so
 * a silently-rewritten history is worse than no history at all.
 */
export interface MedicalRecord extends Timestamps {
  id: MedicalRecordId;
  petId: PetId;
  doctorId: DoctorId;
  clinicId: ClinicId;
  /** Set when the record came out of a booked visit rather than a walk-in. */
  appointmentId?: AppointmentId;

  type: MedicalRecordType;
  visitDate: ISODateString;
  chiefComplaint: string;
  diagnosis: string;
  treatment: string;
  notes?: string;
  vitals?: Vitals;
  prescriptions: Prescription[];
  attachments: MediaAsset[];

  followUpRequired: boolean;
  followUpDate?: DateOnlyString;
  followUpNotes?: string;

  /** Prior versions, newest last. Empty for a record never amended. */
  amendments: RecordAmendment[];
  /** False once locked; the amendment trail takes over. */
  isEditable: boolean;
}

export interface Vitals {
  weightKg?: number;
  temperatureCelsius?: number;
  heartRateBpm?: number;
  respiratoryRateBpm?: number;
  /** Body condition score, the standard 1–9 veterinary scale. */
  bodyConditionScore?: number;
  hydrationStatus?: string;
}

export interface Prescription {
  medication: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  route?: string;
  instructions?: string;
  startDate?: DateOnlyString;
}

export interface RecordAmendment {
  amendedBy: UserId;
  amendedAt: ISODateString;
  reason: string;
  /** Snapshot of the mutated fields as they stood before this amendment. */
  previousValues: Record<string, unknown>;
}

export interface MedicalRecordDetail extends MedicalRecord {
  petName: string;
  doctorName: string;
  doctorTitle: string;
}

export interface CreateMedicalRecordPayload {
  petId: PetId;
  appointmentId?: AppointmentId;
  type: MedicalRecordType;
  visitDate?: ISODateString;
  chiefComplaint: string;
  diagnosis: string;
  treatment: string;
  notes?: string;
  vitals?: Vitals;
  prescriptions?: Prescription[];
  followUpRequired?: boolean;
  followUpDate?: DateOnlyString;
  followUpNotes?: string;
}

export interface UpdateMedicalRecordPayload
  extends Partial<Omit<CreateMedicalRecordPayload, 'petId' | 'appointmentId'>> {
  /** Required once the record has left its free-edit window. */
  amendmentReason?: string;
}

export interface MedicalRecordListQuery {
  page?: number;
  limit?: number;
  petId?: PetId;
  doctorId?: DoctorId;
  type?: MedicalRecordType;
  from?: ISODateString;
  to?: ISODateString;
  search?: string;
}

/* -------------------------------------------------------------------------- */
/*                                Vaccination                                 */
/* -------------------------------------------------------------------------- */

/**
 * A single vaccine dose — administered or scheduled.
 *
 * Modelled as one document per dose rather than one per vaccine with an array
 * of dates, because a dose is what gets reminded about, marked overdue, and
 * reported on. One dose, one row, one lifecycle.
 */
export interface Vaccination extends Timestamps {
  id: string;
  petId: PetId;
  /** Null for a dose scheduled before a clinician has been assigned. */
  doctorId: DoctorId | null;
  clinicId: ClinicId;
  medicalRecordId?: MedicalRecordId;

  vaccineName: string;
  manufacturer?: string;
  batchNumber?: string;
  doseNumber: number;
  totalDoses?: number;

  status: VaccinationStatus;
  administeredAt?: ISODateString;
  /** When the next dose or booster falls due. Drives reminders. */
  dueAt: ISODateString;
  notes?: string;
  /** True once a `vaccination_due` notification has gone out for this dose. */
  reminderSent: boolean;
}

export interface VaccinationDetail extends Vaccination {
  petName: string;
  doctorName?: string;
  /** Negative while still upcoming, positive once overdue. */
  daysUntilDue: number;
}

export interface CreateVaccinationPayload {
  petId: PetId;
  vaccineName: string;
  manufacturer?: string;
  batchNumber?: string;
  doseNumber?: number;
  totalDoses?: number;
  administeredAt?: ISODateString;
  dueAt: ISODateString;
  notes?: string;
  medicalRecordId?: MedicalRecordId;
}

export type UpdateVaccinationPayload = Partial<Omit<CreateVaccinationPayload, 'petId'>> & {
  status?: VaccinationStatus;
};

export interface VaccinationListQuery {
  page?: number;
  limit?: number;
  petId?: PetId;
  status?: VaccinationStatus;
  dueBefore?: ISODateString;
  dueAfter?: ISODateString;
}

/** Row in the "what's coming up" widget on the client dashboard. */
export interface VaccinationScheduleItem {
  petId: PetId;
  petName: string;
  petPhoto?: MediaAsset;
  vaccineName: string;
  dueAt: ISODateString;
  daysUntilDue: number;
  status: VaccinationStatus;
  isOverdue: boolean;
}
