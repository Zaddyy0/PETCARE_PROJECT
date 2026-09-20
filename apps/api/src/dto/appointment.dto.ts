import type { Types } from 'mongoose';
import {
  allowedTransitionsFor,
  canCancel,
  canReschedule,
  REVIEWS,
  Role,
  AppointmentStatus,
  type Appointment as AppointmentDTO,
  type AppointmentDetail,
  type CalendarEntry,
  type Role as RoleType,
} from '@pawsitive/shared';
import type { IAppointment } from '../models/appointment.model.js';

type AppointmentLike = IAppointment & { _id: Types.ObjectId };

export function toAppointmentDTO(appointment: AppointmentLike): AppointmentDTO {
  const dto: AppointmentDTO = {
    id: appointment._id.toString(),
    reference: appointment.reference,
    clientId: appointment.client.toString(),
    petId: appointment.pet.toString(),
    doctorId: appointment.doctor.toString(),
    clinicId: appointment.clinic.toString(),
    slotStart: appointment.slotStart.toISOString(),
    slotEnd: appointment.slotEnd.toISOString(),
    durationMinutes: appointment.durationMinutes,
    type: appointment.type,
    reason: appointment.reason,
    status: appointment.status,
    fee: {
      amountMinor: appointment.feeAmountMinor,
      currency: appointment.feeCurrency,
    },
    remindersSent: appointment.remindersSent.map((date) => date.toISOString()),
    hasReview: appointment.hasReview,
    hasMedicalRecord: appointment.hasMedicalRecord,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
  };

  if (appointment.clientNotes) dto.clientNotes = appointment.clientNotes;
  if (appointment.confirmedAt) dto.confirmedAt = appointment.confirmedAt.toISOString();
  if (appointment.startedAt) dto.startedAt = appointment.startedAt.toISOString();
  if (appointment.completedAt) dto.completedAt = appointment.completedAt.toISOString();
  if (appointment.cancelledAt) dto.cancelledAt = appointment.cancelledAt.toISOString();
  if (appointment.cancelledBy) dto.cancelledBy = appointment.cancelledBy;
  if (appointment.cancellationReason) dto.cancellationReason = appointment.cancellationReason;
  if (appointment.rescheduledFrom) dto.rescheduledFrom = appointment.rescheduledFrom.toString();
  if (appointment.rescheduledTo) dto.rescheduledTo = appointment.rescheduledTo.toString();

  return dto;
}

/** The joined fragments a list or detail view needs, gathered by the service. */
export interface AppointmentRelations {
  pet: { _id: Types.ObjectId; name: string; species: string; breed?: string; photo?: { url: string; publicId: string } | null };
  client: { _id: Types.ObjectId; firstName: string; lastName: string; email: string; phone?: string; avatar?: { url: string; publicId: string } | null };
  doctor: { _id: Types.ObjectId; user: Types.ObjectId; title: string; specializations: string[]; ratingAverage: number };
  doctorUser: { firstName: string; lastName: string; avatar?: { url: string; publicId: string } | null };
}

/**
 * An appointment with everything the UI needs to render its action buttons.
 *
 * `allowedTransitions`, `canCancel`, `canReschedule` and `canReview` are
 * computed **for the calling user**, which is why `viewerRole` is required.
 * Sending these means the client never has to reimplement the state machine or
 * the cancellation window — and can never offer an action the server will
 * reject, because both sides call the same functions from the shared package.
 */
export function toAppointmentDetailDTO(
  appointment: AppointmentLike,
  relations: AppointmentRelations,
  viewer: { role: RoleType; userId: Types.ObjectId },
  now: Date = new Date(),
): AppointmentDetail {
  const base = toAppointmentDTO(appointment);
  const isOwner = appointment.client.toString() === viewer.userId.toString();

  return {
    ...base,
    pet: {
      id: relations.pet._id.toString(),
      name: relations.pet.name,
      species: relations.pet.species as AppointmentDetail['pet']['species'],
      ...(relations.pet.breed ? { breed: relations.pet.breed } : {}),
      ...(relations.pet.photo
        ? { photo: { url: relations.pet.photo.url, publicId: relations.pet.photo.publicId } }
        : {}),
    },
    client: {
      id: relations.client._id.toString(),
      fullName: `${relations.client.firstName} ${relations.client.lastName}`.trim(),
      email: relations.client.email,
      ...(relations.client.phone ? { phone: relations.client.phone } : {}),
      ...(relations.client.avatar
        ? { avatar: { url: relations.client.avatar.url, publicId: relations.client.avatar.publicId } }
        : {}),
    },
    doctor: {
      id: relations.doctor._id.toString(),
      userId: relations.doctor.user.toString(),
      fullName: `${relations.doctorUser.firstName} ${relations.doctorUser.lastName}`.trim(),
      title: relations.doctor.title,
      specializations: [...relations.doctor.specializations],
      rating: relations.doctor.ratingAverage,
      ...(relations.doctorUser.avatar
        ? {
            avatar: {
              url: relations.doctorUser.avatar.url,
              publicId: relations.doctorUser.avatar.publicId,
            },
          }
        : {}),
    },
    allowedTransitions: allowedTransitionsFor(appointment.status, viewer.role),
    canCancel: canCancel(appointment.status, appointment.slotStart, viewer.role, now).allowed,
    canReschedule: canReschedule(appointment.status, appointment.slotStart, viewer.role, now),
    canReview: canReviewAppointment(appointment, isOwner, viewer.role, now),
  };
}

/**
 * May the viewer leave a review right now?
 *
 * Four conditions, all required: they are the client who attended, the visit
 * actually completed, no review exists yet, and the window has not closed.
 * The review service re-checks every one of these — this is for rendering the
 * button, not for authorising the write.
 */
function canReviewAppointment(
  appointment: AppointmentLike,
  isOwner: boolean,
  role: RoleType,
  now: Date,
): boolean {
  if (role !== Role.CLIENT || !isOwner) return false;
  if (appointment.status !== AppointmentStatus.COMPLETED) return false;
  if (appointment.hasReview) return false;

  const completedAt = appointment.completedAt ?? appointment.slotStart;
  const daysSince = (now.getTime() - completedAt.getTime()) / 86_400_000;

  return daysSince <= REVIEWS.WINDOW_DAYS;
}

/**
 * The compact shape for calendar grids.
 *
 * A month view can hold several hundred appointments; sending the full detail
 * payload for each would be megabytes of JSON to render a set of coloured
 * blocks.
 */
export function toCalendarEntryDTO(
  appointment: AppointmentLike,
  names: { petName: string; clientName: string; doctorName: string },
): CalendarEntry {
  return {
    id: appointment._id.toString(),
    reference: appointment.reference,
    slotStart: appointment.slotStart.toISOString(),
    slotEnd: appointment.slotEnd.toISOString(),
    status: appointment.status,
    type: appointment.type,
    petName: names.petName,
    clientName: names.clientName,
    doctorName: names.doctorName,
    doctorId: appointment.doctor.toString(),
  };
}
