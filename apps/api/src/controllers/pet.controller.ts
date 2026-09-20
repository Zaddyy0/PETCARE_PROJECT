import type { Request, Response } from 'express';
import type { CreatePetInput, PetListQueryInput, UpdatePetInput } from '@pawsitive/shared';
import * as petService from '../services/pet.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { body, query } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/api-response.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await petService.listPets(requireAuth(req), query<PetListQueryInput>(req));
  sendPaginated(res, result.items, result.pagination, 'Pets loaded.');
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const pet = await petService.getPet(requireAuth(req), req.params['id'] as string);
  sendSuccess(res, pet, 'Pet loaded.');
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const pet = await petService.createPet(requireAuth(req), body<CreatePetInput>(req));
  sendCreated(res, pet, `${pet.name} has been added.`);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const pet = await petService.updatePet(
    requireAuth(req),
    req.params['id'] as string,
    body<UpdatePetInput>(req),
  );
  sendSuccess(res, pet, `${pet.name} has been updated.`);
});

/**
 * DELETE archives rather than destroying — see `pet.service.ts`.
 *
 * The verb is still DELETE because that is what the client means and what REST
 * conventions lead them to call; the *implementation* being a soft delete is
 * ours to choose. Returning the archived pet rather than 204 lets the UI
 * animate the row out with the final state in hand.
 */
export const archive = asyncHandler(async (req: Request, res: Response) => {
  const deceased = (req.body as { deceased?: boolean } | undefined)?.deceased ?? false;

  const pet = await petService.archivePet(requireAuth(req), req.params['id'] as string, {
    deceased,
  });

  sendSuccess(res, pet, deceased ? 'We are sorry for your loss.' : `${pet.name} has been archived.`);
});

export const restore = asyncHandler(async (req: Request, res: Response) => {
  const pet = await petService.restorePet(requireAuth(req), req.params['id'] as string);
  sendSuccess(res, pet, `${pet.name} is active again.`);
});
