/**
 * Authentication routes.
 *
 * Each route reads as a sentence: which limiter, which schema, who may call it,
 * what runs. Keeping authorization *on the route* rather than inside the
 * handler means a reviewer can audit access control by reading this file alone,
 * without tracing into controllers.
 */

import { Router } from 'express';
import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  impersonateSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  Role,
} from '@pawsitive/shared';
import * as authController from '../controllers/auth.controller.js';
import { authenticate, optionalAuthenticate } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/authorize.js';
import { authLimiter, sensitiveLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

const router: Router = Router();

/* ------------------------------- Public -------------------------------- */

/**
 * `authLimiter` counts only *failures* (`skipSuccessfulRequests`), so a user
 * who legitimately signs in many times is never throttled while someone
 * guessing passwords is stopped after a handful of attempts.
 */
router.post('/register', authLimiter, validate({ body: registerSchema }), authController.register);
router.post('/login', authLimiter, validate({ body: loginSchema }), authController.login);

/* Not rate-limited as an auth attempt: the browser calls this routinely, every
   15 minutes, and reuse detection already handles a stolen token. */
router.post('/refresh', validate({ body: refreshSchema }), authController.refresh);

/**
 * `sensitiveLimiter` — far tighter, because these send email. Without it the
 * endpoint is a free spam relay pointed at any address an attacker chooses.
 */
router.post(
  '/forgot-password',
  sensitiveLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);

router.post(
  '/reset-password',
  sensitiveLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);

router.post(
  '/accept-invite',
  authLimiter,
  validate({ body: acceptInviteSchema }),
  authController.acceptInvite,
);

/* Optional auth: signing out with an expired token must still clear the
   cookie and revoke the session rather than returning 401. */
router.post('/logout', optionalAuthenticate, authController.logout);

/* ----------------------------- Authenticated ---------------------------- */

router.get('/me', authenticate, authController.me);
router.post('/logout-all', authenticate, authController.logoutEverywhere);

router.post(
  '/change-password',
  authenticate,
  sensitiveLimiter,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);

/* ------------------------------ Super admin ----------------------------- */

/**
 * Impersonation is restricted by *role*, not by permission.
 *
 * `requireRole` rather than `requirePermission('user:impersonate')` is
 * deliberate here: this is the one capability where an accidental grant in the
 * permission matrix would be catastrophic, so it is pinned to the role
 * explicitly as well. Both checks must pass.
 */
router.post(
  '/impersonate',
  authenticate,
  requireRole(Role.SUPER_ADMIN),
  sensitiveLimiter,
  validate({ body: impersonateSchema }),
  authController.impersonate,
);

export default router;
