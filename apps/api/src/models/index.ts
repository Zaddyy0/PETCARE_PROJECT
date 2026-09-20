/**
 * Model barrel.
 *
 * Importing from here also guarantees every schema is registered with Mongoose
 * before any query runs. Registration order matters for `ref`-based populate:
 * a `populate('doctor')` against a model that has not been loaded yet throws
 * `MissingSchemaError`, and which file happens to import which is a fragile
 * thing to depend on.
 */

export { User, type IUser, type UserDocument, type UserModel } from './user.model.js';
export { Clinic, type IClinic, type ClinicDocument } from './clinic.model.js';
export {
  Doctor,
  defaultWeeklyAvailability,
  type IDoctor,
  type IDoctorAvailability,
  type DoctorDocument,
} from './doctor.model.js';
export { Pet, type IPet, type PetDocument } from './pet.model.js';
export {
  Appointment,
  isSlotConflictError,
  type IAppointment,
  type AppointmentDocument,
} from './appointment.model.js';
export {
  MedicalRecord,
  type IMedicalRecord,
  type MedicalRecordDocument,
} from './medical-record.model.js';
export {
  Vaccination,
  type IVaccination,
  type VaccinationDocument,
} from './vaccination.model.js';
export {
  Review,
  isDuplicateReviewError,
  type IReview,
  type ReviewDocument,
} from './review.model.js';
export {
  Notification,
  type INotification,
  type NotificationDocument,
} from './notification.model.js';
export { AuditLog, type IAuditLog, type AuditLogDocument } from './audit-log.model.js';
export {
  RefreshToken,
  type IRefreshToken,
  type RefreshTokenDocument,
} from './refresh-token.model.js';
