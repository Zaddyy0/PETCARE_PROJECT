import type { Request, Response } from 'express';
import type {
  AppointmentListQueryInput,
  CreateAppointmentInput,
  RescheduleAppointmentInput,
  TransitionAppointmentInput,
} from '@pawsitive/shared';
import * as appointmentService from '../services/appointment.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { body, query } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/api-response.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await appointmentService.listAppointments(
    requireAuth(req),
    query<AppointmentListQueryInput>(req),
  );
  sendPaginated(res, result.items, result.pagination, 'Appointments loaded.');
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await appointmentService.getAppointment(
    requireAuth(req),
    req.params['id'] as string,
  );
  sendSuccess(res, appointment, 'Appointment loaded.');
});

export const book = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await appointmentService.bookAppointment(
    requireAuth(req),
    body<CreateAppointmentInput>(req),
  );

  sendCreated(res, appointment, `Booked — your reference is ${appointment.reference}.`);
});

export const reschedule = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await appointmentService.rescheduleAppointment(
    requireAuth(req),
    req.params['id'] as string,
    body<RescheduleAppointmentInput>(req),
  );

  sendSuccess(res, appointment, 'Appointment moved.');
});

export const transition = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await appointmentService.transitionAppointment(
    requireAuth(req),
    req.params['id'] as string,
    body<TransitionAppointmentInput>(req),
  );

  sendSuccess(res, appointment, 'Appointment updated.');
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await appointmentService.cancelAppointment(
    requireAuth(req),
    req.params['id'] as string,
    body<{ reason: string }>(req),
  );

  sendSuccess(res, appointment, 'Appointment cancelled.');
});

/**
 * The calendar returns a bare array rather than a paginated envelope.
 *
 * A calendar is bounded by its date window, not by a page — the client asks
 * for a week or a month and wants all of it. The service caps the result so an
 * absurd range cannot return an unbounded payload.
 */
export const calendar = asyncHandler(async (req: Request, res: Response) => {
  const entries = await appointmentService.getCalendar(
    requireAuth(req),
    query<{ from: string; to: string; doctorId?: string; clinicId?: string }>(req),
  );

  sendSuccess(res, entries, 'Calendar loaded.', 200, { count: entries.length });
});
