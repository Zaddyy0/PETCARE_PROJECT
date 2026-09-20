/**
 * DTO barrel.
 *
 * Nothing in `services/` or `controllers/` should ever return a Mongoose
 * document directly — everything leaves through a mapper here. That is what
 * makes the API contract explicit and auditable: to know what an endpoint
 * emits, read one function, not a schema plus three transforms plus whatever
 * `populate()` happened to attach.
 */

export { toUserDTO, toCurrentUserDTO, toClinicDTO } from './user.dto.js';
export { toPetDTO, toPetSummaryDTO, type PetSummaryExtras } from './pet.dto.js';
export { toDoctorDTO, toPublicDoctorDTO, toAvailabilityDTO } from './doctor.dto.js';
export {
  toAppointmentDTO,
  toAppointmentDetailDTO,
  toCalendarEntryDTO,
  type AppointmentRelations,
} from './appointment.dto.js';
export {
  toMedicalRecordDTO,
  toVaccinationDTO,
  toVaccinationDetailDTO,
} from './medical.dto.js';
export { toReviewDTO, toReviewDetailDTO, type ReviewRelations } from './review.dto.js';
export { toNotificationDTO } from './notification.dto.js';
