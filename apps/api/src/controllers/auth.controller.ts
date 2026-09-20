/**
 * Auth controllers.
 *
 * Controllers here do exactly three things: read validated input, call a
 * service, and shape the HTTP response. No business rules, no database access,
 * no authorization logic — all of that lives in the service, where it can be
 * tested without an HTTP layer and reused by a job or a socket handler.
 *
 * The one genuinely HTTP-specific concern they *do* own is the refresh cookie,
 * because a cookie is a transport detail the service has no business knowing
 * about.
 */

import type { Request, Response } from 'express';
import type {
  AcceptInviteInput,
  ChangePasswordInput,
  ImpersonateInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from '@pawsitive/shared';
import { Types } from 'mongoose';
import { ERROR_CODES, maskEmail } from '@pawsitive/shared';
import * as authService from '../services/auth.service.js';
import { actorFromRequest } from '../services/audit.service.js';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../services/token.service.js';
import { requireAuth } from '../middleware/authorize.js';
import { body } from '../middleware/validate.js';
import { ApiError } from '../utils/api-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { sendCreated, sendSuccess } from '../utils/api-response.js';

/** Everything a service needs to know about where a request came from. */
function contextOf(req: Request): authService.RequestContext {
  return {
    ...(req.get('user-agent') ? { userAgent: req.get('user-agent') } : {}),
    ...(req.ip ? { ipAddress: req.ip } : {}),
    request: req,
  };
}

/**
 * Put the refresh token in an httpOnly cookie and keep it out of the body.
 *
 * This is the whole point of the two-token split: the access token goes to
 * JavaScript, the refresh token does not. Returning the refresh token in JSON
 * as well would hand it straight back to any XSS payload and make the cookie
 * pointless.
 */
function setRefreshCookie(res: Response, refresh: { token: string; expiresAt: Date }): void {
  res.cookie(REFRESH_COOKIE_NAME, refresh.token, refreshCookieOptions(refresh.expiresAt));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...refreshCookieOptions(new Date(0)),
    expires: new Date(0),
  });
}

/** The body shape returned by every endpoint that establishes a session. */
function sessionBody(result: authService.SessionResult) {
  return {
    user: result.user,
    tokens: {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      tokenType: 'Bearer' as const,
    },
  };
}

/* -------------------------------------------------------------------------- */

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.register(body<RegisterInput>(req), contextOf(req));

  setRefreshCookie(res, result.refresh);
  sendCreated(res, sessionBody(result), 'Welcome to Pawsitive!');
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login(body<LoginInput>(req), contextOf(req));

  setRefreshCookie(res, result.refresh);
  sendSuccess(res, sessionBody(result), 'Signed in successfully.');
});

/**
 * Rotate the session.
 *
 * The token is read from the cookie, falling back to the body for non-browser
 * clients that cannot use cookies.
 */
export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const fromCookie = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  const token = fromCookie ?? fromBody;

  if (!token) {
    throw ApiError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }

  try {
    const result = await authService.refresh(token, contextOf(req));

    setRefreshCookie(res, result.refresh);
    sendSuccess(res, sessionBody(result), 'Session refreshed.');
  } catch (error) {
    /* Any refresh failure ends the session, so clear the cookie rather than
       leaving the browser to re-present a token that will never work again. */
    clearRefreshCookie(res);
    throw error;
  }
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  /* `optionalAuthenticate` fronts this route: signing out with an already
     expired access token should still clear the cookie and revoke the session,
     not fail with a 401. */
  if (req.auth) {
    await authService.logout(req.auth.sessionId);
  }

  clearRefreshCookie(res);
  sendSuccess(res, null, 'Signed out.');
});

export const logoutEverywhere = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const revoked = await authService.logoutEverywhere(auth.userId);

  clearRefreshCookie(res);
  sendSuccess(res, { revokedSessions: revoked }, 'Signed out on all devices.');
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const user = await authService.currentUser(auth.userId, auth.impersonatorId);

  sendSuccess(res, user, 'Profile loaded.');
});

/* -------------------------------------------------------------------------- */
/*                               Password reset                               */
/* -------------------------------------------------------------------------- */

/**
 * Always reports success.
 *
 * The service does not tell us whether the address existed, and this response
 * is identical either way — that is deliberate, and the reason is in
 * `auth.service.ts`. The masked address is echoed purely so a user who
 * mistyped their own email can notice.
 */
export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = body<{ email: string }>(req);

  await authService.forgotPassword(email);

  sendSuccess(
    res,
    { email: maskEmail(email) },
    'If that address has an account, a reset link is on its way.',
  );
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const input = body<ResetPasswordInput>(req);

  await authService.resetPassword(input.token, input.password, contextOf(req));

  clearRefreshCookie(res);
  sendSuccess(res, null, 'Your password has been reset. Please sign in.');
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);

  await authService.changePassword(auth.userId, body<ChangePasswordInput>(req), contextOf(req));

  clearRefreshCookie(res);
  sendSuccess(res, null, 'Password changed. Please sign in again.');
});

export const acceptInvite = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.acceptInvite(body<AcceptInviteInput>(req), contextOf(req));

  setRefreshCookie(res, result.refresh);
  sendSuccess(res, sessionBody(result), 'Your account is ready.');
});

/* -------------------------------------------------------------------------- */
/*                               Impersonation                                */
/* -------------------------------------------------------------------------- */

export const impersonate = asyncHandler(async (req: Request, res: Response) => {
  const auth = requireAuth(req);
  const input = body<ImpersonateInput>(req);

  const actor = actorFromRequest(req);

  const result = await authService.impersonate(
    { ...actor, id: auth.userId },
    new Types.ObjectId(input.userId),
    input.reason,
    contextOf(req),
  );

  /**
   * No refresh cookie for an impersonation session.
   *
   * It is deliberately short-lived and non-renewable: when the access token
   * expires the super admin drops back to their own session rather than
   * silently staying as someone else. Issuing a refresh cookie would also
   * overwrite their real one.
   */
  sendSuccess(res, sessionBody(result), `You are now viewing as ${result.user.fullName}.`);
});
