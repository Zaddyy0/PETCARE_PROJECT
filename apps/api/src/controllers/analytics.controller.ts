import type { Request, Response } from 'express';
import type { AnalyticsQuery } from '@pawsitive/shared';
import * as analyticsService from '../services/analytics.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { query } from '../middleware/validate.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendSuccess } from '../utils/api-response.js';

/**
 * One dashboard endpoint for every role.
 *
 * The response is a discriminated union tagged with `scope`, and the *server*
 * chooses which variant to build from the caller's permissions. The client
 * never names a scope, so there is no "may this user request platform
 * analytics?" check that could be forgotten — a doctor asking for analytics
 * gets doctor analytics by construction.
 */
export const dashboard = asyncHandler(async (req: Request, res: Response) => {
  const result = await analyticsService.getDashboard(requireAuth(req), query<AnalyticsQuery>(req));

  sendSuccess(res, result, 'Dashboard loaded.', 200, { scope: result.scope });
});
