/**
 * Authorization middleware — layer 1 of the two-layer model described in
 * `@pawsitive/shared/permissions.ts`.
 *
 * This layer answers **"may this role ever do X?"** and nothing more. It is
 * cheap, declarative, and sits on the route definition where a reviewer can see
 * it next to the handler:
 *
 *     router.post('/', requirePermission('doctor:create'), createDoctor)
 *
 * It deliberately cannot answer **"may this user do X to this row?"** — it has
 * no document in hand. That question belongs to the service layer, which loads
 * the record and checks ownership or clinic scope. Treating a passed
 * `requirePermission` as full authorization is the classic broken-access-control
 * bug: every doctor holds `medical_record:write`, but only for *their* patients.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  ERROR_CODES,
  ROLE_RANK,
  Role,
  canActOnRole,
  type Permission,
  type Role as RoleType,
} from '@pawsitive/shared';
import { ApiError } from '../utils/api-error.js';
import type { AuthContext } from '../types/express.js';

/**
 * Narrow `req.auth` to a guaranteed context.
 *
 * Throws rather than returning null so a controller placed behind
 * `authenticate` cannot silently treat an anonymous request as a valid one —
 * the most dangerous possible failure mode for this function.
 */
export function requireAuth(req: Request): AuthContext {
  if (!req.auth) {
    throw ApiError.unauthorized(ERROR_CODES.UNAUTHENTICATED);
  }
  return req.auth;
}

/** Require one specific capability. */
export function requirePermission(...permissions: Permission[]) {
  return function checkPermission(req: Request, _res: Response, next: NextFunction): void {
    const auth = requireAuth(req);

    const missing = permissions.filter((permission) => !auth.permissions.has(permission));

    if (missing.length > 0) {
      next(
        new ApiError({
          statusCode: 403,
          code: ERROR_CODES.INSUFFICIENT_PERMISSION,
          /* The message stays generic; the specifics go to the log, where they
             help us debug without telling a prober the permission names. */
          context: { required: permissions, missing, role: auth.role },
        }),
      );
      return;
    }

    next();
  };
}

/** Require *any one* of several capabilities. */
export function requireAnyPermission(...permissions: Permission[]) {
  return function checkAnyPermission(req: Request, _res: Response, next: NextFunction): void {
    const auth = requireAuth(req);

    if (!permissions.some((permission) => auth.permissions.has(permission))) {
      next(
        new ApiError({
          statusCode: 403,
          code: ERROR_CODES.INSUFFICIENT_PERMISSION,
          context: { requiredAny: permissions, role: auth.role },
        }),
      );
      return;
    }

    next();
  };
}

/**
 * Require one of an explicit set of roles.
 *
 * Prefer `requirePermission` — it says *why* the route is restricted, and it
 * survives a new role being added. Use this only where the rule genuinely is
 * about identity rather than capability, such as a route that exists solely for
 * super admins.
 */
export function requireRole(...roles: RoleType[]) {
  return function checkRole(req: Request, _res: Response, next: NextFunction): void {
    const auth = requireAuth(req);

    if (!roles.includes(auth.role)) {
      next(
        new ApiError({
          statusCode: 403,
          code: ERROR_CODES.FORBIDDEN,
          context: { requiredRoles: roles, role: auth.role },
        }),
      );
      return;
    }

    next();
  };
}

/** Require a role of at least the given rank. */
export function requireMinimumRole(minimum: RoleType) {
  return function checkRank(req: Request, _res: Response, next: NextFunction): void {
    const auth = requireAuth(req);

    if (ROLE_RANK[auth.role] < ROLE_RANK[minimum]) {
      next(
        new ApiError({
          statusCode: 403,
          code: ERROR_CODES.FORBIDDEN,
          context: { minimum, role: auth.role },
        }),
      );
      return;
    }

    next();
  };
}

/**
 * Guard an action taken against another user's account.
 *
 * Prevents privilege escalation sideways and upwards: an admin cannot suspend
 * another admin or a super admin, and cannot promote anyone to a rank at or
 * above their own. Without this, "admin can edit users" quietly means "admin
 * can make themselves super admin".
 *
 * Called from services, which know the target's role — not from the router,
 * which does not.
 */
export function assertCanActOnUser(actorRole: RoleType, targetRole: RoleType): void {
  if (!canActOnRole(actorRole, targetRole)) {
    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.CANNOT_ACT_ON_ROLE,
      context: { actorRole, targetRole },
    });
  }
}

/**
 * Guard a role assignment.
 *
 * Separate from `assertCanActOnUser` because the dangerous direction is
 * different: there, the question is whether the *target* outranks the actor;
 * here it is whether the *new role* would.
 */
export function assertCanAssignRole(actorRole: RoleType, newRole: RoleType): void {
  if (actorRole === Role.SUPER_ADMIN) return;

  if (ROLE_RANK[newRole] >= ROLE_RANK[actorRole]) {
    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.CANNOT_ACT_ON_ROLE,
      message: 'You cannot grant a role equal to or above your own.',
      context: { actorRole, newRole },
    });
  }
}

/**
 * Confirm a record belongs to the actor's clinic.
 *
 * Super admins are global and skip the check. Everyone else is pinned to their
 * own clinic, which is the tenancy boundary — this is what stops one practice
 * reading another's patient list by guessing an id.
 */
export function assertWithinClinicScope(
  auth: AuthContext,
  resourceClinicId: { toString(): string } | null | undefined,
): void {
  if (auth.role === Role.SUPER_ADMIN) return;

  if (!auth.clinicId || !resourceClinicId) {
    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.OUTSIDE_CLINIC_SCOPE,
    });
  }

  if (auth.clinicId.toString() !== resourceClinicId.toString()) {
    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.OUTSIDE_CLINIC_SCOPE,
      context: { actorClinic: auth.clinicId.toString() },
    });
  }
}

/**
 * Confirm the actor owns a record, or holds an override capability.
 *
 * The 404-vs-403 question matters here. We return 403 because the caller has
 * already proved they are authenticated and the id came from somewhere; a 404
 * would be the better answer for a *public* id space, where distinguishing
 * "does not exist" from "not yours" is itself a leak. Services that expose
 * guessable ids should prefer `notFound` for exactly that reason.
 */
export function assertOwnership(
  auth: AuthContext,
  ownerId: { toString(): string } | null | undefined,
  override?: Permission,
): void {
  if (override && auth.permissions.has(override)) return;

  if (!ownerId || auth.userId.toString() !== ownerId.toString()) {
    throw new ApiError({
      statusCode: 403,
      code: ERROR_CODES.NOT_RESOURCE_OWNER,
    });
  }
}
