import type { Request, Response } from 'express';
import type {
  CreateMedicalRecordInput,
  CreateVaccinationInput,
  MedicalRecordListQueryInput,
  UpdateMedicalRecordInput,
  UpdateVaccinationInput,
  VaccinationListQueryInput,
} from '@pawsitive/shared';
import * as recordService from '../services/medical-record.service.js';
import * as vaccinationService from '../services/vaccination.service.js';
import { actorFromRequest } from '../services/audit.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { body, query } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/api-response.js';

/* ----------------------------- Medical records --------------------------- */

export const listRecords = asyncHandler(async (req: Request, res: Response) => {
  const result = await recordService.listRecords(
    requireAuth(req),
    query<MedicalRecordListQueryInput>(req),
  );
  sendPaginated(res, result.items, result.pagination, 'Records loaded.');
});

export const getRecord = asyncHandler(async (req: Request, res: Response) => {
  const record = await recordService.getRecord(requireAuth(req), req.params['id'] as string);
  sendSuccess(res, record, 'Record loaded.');
});

export const petTimeline = asyncHandler(async (req: Request, res: Response) => {
  const records = await recordService.getPetTimeline(
    requireAuth(req),
    req.params['petId'] as string,
  );
  sendSuccess(res, records, 'Timeline loaded.', 200, { count: records.length });
});

export const createRecord = asyncHandler(async (req: Request, res: Response) => {
  const record = await recordService.createRecord(
    requireAuth(req),
    body<CreateMedicalRecordInput>(req),
    actorFromRequest(req),
  );
  sendCreated(res, record, 'Record saved.');
});

export const updateRecord = asyncHandler(async (req: Request, res: Response) => {
  const record = await recordService.updateRecord(
    requireAuth(req),
    req.params['id'] as string,
    body<UpdateMedicalRecordInput>(req),
    actorFromRequest(req),
  );

  /* Whether this became an amendment is visible in the response, so the UI can
     say "amended" rather than "saved" without guessing. */
  const amended = record.amendments.length > 0;
  sendSuccess(res, record, amended ? 'Amendment recorded.' : 'Record updated.');
});

export const lockRecord = asyncHandler(async (req: Request, res: Response) => {
  const record = await recordService.lockRecord(
    requireAuth(req),
    req.params['id'] as string,
    actorFromRequest(req),
  );
  sendSuccess(res, record, 'Record signed off and locked.');
});

/* ------------------------------ Vaccinations ----------------------------- */

export const listVaccinations = asyncHandler(async (req: Request, res: Response) => {
  const result = await vaccinationService.listVaccinations(
    requireAuth(req),
    query<VaccinationListQueryInput>(req),
  );
  sendPaginated(res, result.items, result.pagination, 'Vaccinations loaded.');
});

export const schedule = asyncHandler(async (req: Request, res: Response) => {
  const withinDays = Number((req.query['withinDays'] as string | undefined) ?? 60);

  const items = await vaccinationService.getSchedule(requireAuth(req), {
    withinDays: Number.isFinite(withinDays) ? Math.min(365, Math.max(1, withinDays)) : 60,
  });

  sendSuccess(res, items, 'Vaccination schedule loaded.', 200, {
    overdue: items.filter((item) => item.isOverdue).length,
  });
});

export const createVaccination = asyncHandler(async (req: Request, res: Response) => {
  const vaccination = await vaccinationService.createVaccination(
    requireAuth(req),
    body<CreateVaccinationInput>(req),
  );
  sendCreated(res, vaccination, 'Vaccination recorded.');
});

export const updateVaccination = asyncHandler(async (req: Request, res: Response) => {
  const vaccination = await vaccinationService.updateVaccination(
    requireAuth(req),
    req.params['id'] as string,
    body<UpdateVaccinationInput>(req),
  );
  sendSuccess(res, vaccination, 'Vaccination updated.');
});
