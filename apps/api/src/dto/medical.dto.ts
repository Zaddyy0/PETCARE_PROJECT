import type { Types } from 'mongoose';
import type {
  MedicalRecord as MedicalRecordDTO,
  Vaccination as VaccinationDTO,
  VaccinationDetail,
} from '@pawsitive/shared';
import type { IMedicalRecord } from '../models/medical-record.model.js';
import type { IVaccination } from '../models/vaccination.model.js';

type MedicalRecordLike = IMedicalRecord & { _id: Types.ObjectId };
type VaccinationLike = IVaccination & { _id: Types.ObjectId };

export function toMedicalRecordDTO(
  record: MedicalRecordLike,
  isEditable: boolean,
): MedicalRecordDTO {
  const dto: MedicalRecordDTO = {
    id: record._id.toString(),
    petId: record.pet.toString(),
    doctorId: record.doctor.toString(),
    clinicId: record.clinic.toString(),
    type: record.type,
    visitDate: record.visitDate.toISOString(),
    chiefComplaint: record.chiefComplaint,
    diagnosis: record.diagnosis,
    treatment: record.treatment,
    prescriptions: record.prescriptions.map((prescription) => ({
      medication: prescription.medication,
      dosage: prescription.dosage,
      frequency: prescription.frequency,
      durationDays: prescription.durationDays,
      ...(prescription.route ? { route: prescription.route } : {}),
      ...(prescription.instructions ? { instructions: prescription.instructions } : {}),
      ...(prescription.startDate
        ? { startDate: prescription.startDate.toISOString().slice(0, 10) }
        : {}),
    })),
    attachments: record.attachments.map((attachment) => ({
      url: attachment.url,
      publicId: attachment.publicId,
      ...(attachment.format ? { format: attachment.format } : {}),
      ...(attachment.bytes ? { bytes: attachment.bytes } : {}),
    })),
    followUpRequired: record.followUpRequired,
    /**
     * The amendment trail is public to anyone who can read the record.
     *
     * That is the point of keeping it: a history that only the clinic can see
     * is no use to an owner disputing what was written, and the trail is what
     * makes the record defensible rather than merely editable.
     */
    amendments: record.amendments.map((amendment) => ({
      amendedBy: amendment.amendedBy.toString(),
      amendedAt: amendment.amendedAt.toISOString(),
      reason: amendment.reason,
      previousValues: amendment.previousValues,
    })),
    isEditable,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };

  if (record.appointment) dto.appointmentId = record.appointment.toString();
  if (record.notes) dto.notes = record.notes;
  if (record.vitals) dto.vitals = { ...record.vitals };
  if (record.followUpDate) {
    dto.followUpDate = record.followUpDate.toISOString().slice(0, 10);
  }
  if (record.followUpNotes) dto.followUpNotes = record.followUpNotes;

  return dto;
}

export function toVaccinationDTO(vaccination: VaccinationLike): VaccinationDTO {
  const dto: VaccinationDTO = {
    id: vaccination._id.toString(),
    petId: vaccination.pet.toString(),
    doctorId: vaccination.doctor ? vaccination.doctor.toString() : null,
    clinicId: vaccination.clinic.toString(),
    vaccineName: vaccination.vaccineName,
    doseNumber: vaccination.doseNumber,
    status: vaccination.status,
    dueAt: vaccination.dueAt.toISOString(),
    reminderSent: vaccination.reminderSent,
    createdAt: vaccination.createdAt.toISOString(),
    updatedAt: vaccination.updatedAt.toISOString(),
  };

  if (vaccination.medicalRecord) dto.medicalRecordId = vaccination.medicalRecord.toString();
  if (vaccination.manufacturer) dto.manufacturer = vaccination.manufacturer;
  if (vaccination.batchNumber) dto.batchNumber = vaccination.batchNumber;
  if (vaccination.totalDoses != null) dto.totalDoses = vaccination.totalDoses;
  if (vaccination.administeredAt) {
    dto.administeredAt = vaccination.administeredAt.toISOString();
  }
  if (vaccination.notes) dto.notes = vaccination.notes;

  return dto;
}

export function toVaccinationDetailDTO(
  vaccination: VaccinationLike,
  names: { petName: string; doctorName?: string },
  now: Date = new Date(),
): VaccinationDetail {
  const base = toVaccinationDTO(vaccination);

  /* Negative while still upcoming, positive once overdue — so a single sort on
     this column puts the most overdue first. */
  const daysUntilDue = Math.ceil(
    (now.getTime() - vaccination.dueAt.getTime()) / 86_400_000,
  );

  return {
    ...base,
    petName: names.petName,
    ...(names.doctorName ? { doctorName: names.doctorName } : {}),
    daysUntilDue,
  };
}
