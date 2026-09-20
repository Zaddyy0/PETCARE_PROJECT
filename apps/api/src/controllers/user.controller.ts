import type { Request, Response } from 'express';
import type {
  CreateUserInput,
  Role,
  UpdateProfileInput,
  UpdateUserInput,
  UserListQueryInput,
} from '@pawsitive/shared';
import * as userService from '../services/user.service.js';
import { actorFromRequest } from '../services/audit.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { body, query } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendPaginated, sendSuccess } from '../utils/api-response.js';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.listUsers(requireAuth(req), query<UserListQueryInput>(req));
  sendPaginated(res, result.items, result.pagination, 'Users loaded.');
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.getUser(requireAuth(req), req.params['id'] as string);
  sendSuccess(res, user, 'User loaded.');
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.createUser(
    requireAuth(req),
    body<CreateUserInput>(req),
    actorFromRequest(req),
  );
  sendCreated(res, user, `${user.fullName} has been added.`);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateUser(
    requireAuth(req),
    req.params['id'] as string,
    body<UpdateUserInput>(req),
    actorFromRequest(req),
  );
  sendSuccess(res, user, 'User updated.');
});

/** Self-service. Deliberately separate from `update`, which is an admin action. */
export const updateOwnProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.updateOwnProfile(requireAuth(req), body<UpdateProfileInput>(req));
  sendSuccess(res, user, 'Profile updated.');
});

export const changeRole = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.changeRole(
    requireAuth(req),
    req.params['id'] as string,
    body<{ role: Role; clinicId?: string; reason: string }>(req),
    actorFromRequest(req),
  );

  /* The role change revoked their sessions, so say so — otherwise the admin
     wonders why the user was signed out. */
  sendSuccess(res, user, `Role changed to ${user.role.replace('_', ' ')}. They have been signed out.`);
});

export const suspend = asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.suspendUser(
    requireAuth(req),
    req.params['id'] as string,
    body<{ reason: string; until?: string }>(req),
    actorFromRequest(req),
  );

  sendSuccess(
    res,
    result,
    `Account suspended and ${result.revokedSessions} session${result.revokedSessions === 1 ? '' : 's'} ended.`,
  );
});

export const reactivate = asyncHandler(async (req: Request, res: Response) => {
  const user = await userService.reactivateUser(
    requireAuth(req),
    req.params['id'] as string,
    actorFromRequest(req),
  );
  sendSuccess(res, user, 'Account reactivated.');
});

export const resendInvite = asyncHandler(async (req: Request, res: Response) => {
  const result = await userService.resendInvite(requireAuth(req), req.params['id'] as string);

  /* `delivered` is false when mail is disabled — worth telling the admin rather
     than claiming success. */
  sendSuccess(
    res,
    result,
    result.delivered
      ? `A new invitation is on its way to ${result.email}.`
      : 'Invitation regenerated, but email delivery is not configured.',
  );
});

export const listClinics = asyncHandler(async (req: Request, res: Response) => {
  const clinics = await userService.listClinics(requireAuth(req));
  sendSuccess(res, clinics, 'Clinics loaded.');
});
