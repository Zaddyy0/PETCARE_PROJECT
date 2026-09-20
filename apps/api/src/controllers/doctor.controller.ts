import type { Request, Response } from 'express';
import type {
  CreateDoctorInput,
  DoctorListQueryInput,
  SlotQueryInput,
  UpdateAvailabilityInput,
  UpdateDoctorInput,
} from '@pawsitive/shared';
import * as doctorService from '../services/doctor.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { body, query } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/api-response.js';

/**
 * The directory is readable without a session.
 *
 * `req.auth` may be absent here — the route uses `optionalAuthenticate` so a
 * prospective client can browse doctors before signing up, while a signed-in
 * staff member gets their clinic's list. The service handles both.
 */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await doctorService.listDoctors(
    req.auth ?? null,
    query<DoctorListQueryInput>(req),
  );
  sendPaginated(res, result.items, result.pagination, 'Doctors loaded.');
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const doctor = await doctorService.getDoctor(req.auth ?? null, req.params['id'] as string);
  sendSuccess(res, doctor, 'Doctor loaded.');
});

/**
 * The bookable slot grid.
 *
 * Public: a client needs to see when a doctor is free *before* committing to
 * an account. It exposes only times, never who holds a booked slot.
 */
export const slots = asyncHandler(async (req: Request, res: Response) => {
  const result = await doctorService.getAvailableSlots(
    req.params['id'] as string,
    query<SlotQueryInput>(req),
  );

  sendSuccess(res, result, 'Availability loaded.', 200, {
    total: result.slots.length,
    available: result.slots.filter((slot) => slot.isAvailable).length,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const doctor = await doctorService.createDoctor(requireAuth(req), body<CreateDoctorInput>(req));
  sendCreated(res, doctor, `${doctor.fullName} has been added.`);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const doctor = await doctorService.updateDoctor(
    requireAuth(req),
    req.params['id'] as string,
    body<UpdateDoctorInput>(req),
  );
  sendSuccess(res, doctor, 'Profile updated.');
});

export const updateAvailability = asyncHandler(async (req: Request, res: Response) => {
  const result = await doctorService.updateAvailability(
    requireAuth(req),
    req.params['id'] as string,
    body<UpdateAvailabilityInput>(req),
  );

  /**
   * Existing bookings are never cancelled by an hours change — see the service.
   * We surface the count so the UI can warn rather than leaving the clinic to
   * discover it on the day.
   */
  const message =
    result.appointmentsOutsideNewHours > 0
      ? `Availability saved. ${result.appointmentsOutsideNewHours} existing appointment${result.appointmentsOutsideNewHours === 1 ? ' falls' : 's fall'} outside the new hours and will still go ahead.`
      : 'Availability saved.';

  sendSuccess(res, result, message);
});

export const deactivate = asyncHandler(async (req: Request, res: Response) => {
  const result = await doctorService.deactivateDoctor(requireAuth(req), req.params['id'] as string);
  sendSuccess(res, result, 'Doctor deactivated.');
});
