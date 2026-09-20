/**
 * Data scoping — layer 2 of the authorization model.
 *
 * Layer 1 (`requirePermission`) answers "may this role ever do X?". This is the
 * other half: **which rows** may they do it to.
 *
 * The rule enforced here is that a list query is never issued without a scope
 * filter. A missing `.where()` on a list endpoint is the single most common way
 * one tenant ends up reading another's data, and it produces no error — just a
 * quietly over-broad result that looks fine in development where there is only
 * one clinic.
 *
 * Centralising the translation means the decision is made once, in a place that
 * can be read and tested, rather than re-derived in every service.
 */

import { Types } from 'mongoose';
import {
  ERROR_CODES,
  Role,
  resolveScope,
  type DataScope,
  type ErrorCode,
} from '@pawsitive/shared';
import { ApiError } from '../utils/api-error.js';
import type { AuthContext } from '../types/express.js';

export type ScopeFilter = Record<string, unknown>;

export interface ScopeFields {
  /** Field holding the owning user, e.g. `owner` on Pet, `client` on Appointment. */
  ownerField?: string;
  /** Field holding the clinic, for staff-scoped resources. */
  clinicField?: string;
  /** Field holding the Doctor profile id, for doctor-scoped resources. */
  doctorField?: string;
}

/**
 * Build the mandatory filter for a list query.
 *
 * `global` returns `{}` — but only for a role that genuinely holds a platform-
 * wide permission. Every other scope pins the query to the caller.
 *
 * A doctor is a special case worth noting: they are clinic staff, but for
 * *appointments* they should see their own list rather than the clinic's whole
 * calendar, so `doctorField` takes precedence when present.
 */
export function buildScopeFilter(
  auth: AuthContext,
  resource: 'pet' | 'appointment' | 'medical_record' | 'user' | 'analytics',
  fields: ScopeFields,
): ScopeFilter {
  const scope = resolveScope(auth.role, resource);

  switch (scope) {
    case 'global':
      return {};

    case 'clinic': {
      /* A doctor scoped to a clinic resource still only sees their own rows
         where the resource has a doctor field. */
      if (auth.role === Role.DOCTOR && fields.doctorField && auth.doctorId) {
        return { [fields.doctorField]: auth.doctorId };
      }

      if (!auth.clinicId) {
        /* Staff with no clinic assigned can see nothing rather than everything
           — failing closed is the only safe default here. */
        throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
      }

      if (!fields.clinicField) {
        throw ApiError.forbidden(ERROR_CODES.OUTSIDE_CLINIC_SCOPE);
      }

      return { [fields.clinicField]: auth.clinicId };
    }

    case 'own': {
      if (!fields.ownerField) {
        throw ApiError.forbidden(ERROR_CODES.FORBIDDEN);
      }
      return { [fields.ownerField]: auth.userId };
    }

    case 'none':
    default:
      throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);
  }
}

export function scopeOf(
  auth: AuthContext,
  resource: 'pet' | 'appointment' | 'medical_record' | 'user' | 'analytics',
): DataScope {
  return resolveScope(auth.role, resource);
}

/**
 * Narrow a caller-supplied filter to something they are allowed to ask for.
 *
 * Staff may filter a list by `clientId` or `doctorId`; a client may not — for
 * them those parameters are silently dropped rather than honoured, since
 * accepting `?clientId=<someone-else>` would hand over another person's data
 * through a query string.
 *
 * Dropping rather than erroring is deliberate: a client's UI never sends these,
 * so anything that does is either a probe or a bug, and neither deserves a
 * helpful error message.
 */
export function applyRequestedFilters(
  auth: AuthContext,
  base: ScopeFilter,
  requested: Record<string, string | Types.ObjectId | undefined>,
  allowedForStaffOnly: string[],
): ScopeFilter {
  const filter = { ...base };
  const isStaff = auth.role !== Role.CLIENT;

  for (const [field, value] of Object.entries(requested)) {
    if (!value) continue;
    if (allowedForStaffOnly.includes(field) && !isStaff) continue;

    /* Never let a requested filter widen an existing scope constraint — if the
       scope already pins this field, the scope wins. */
    if (field in base) continue;

    filter[field] = typeof value === 'string' ? new Types.ObjectId(value) : value;
  }

  return filter;
}

/**
 * Assert the caller may reach a specific document.
 *
 * Used after loading a single record by id. Returning 404 rather than 403 for
 * an out-of-scope row is deliberate where ids are guessable: a 403 confirms the
 * record exists, which is itself information.
 */
export interface OwnershipCheck {
  ownerId?: Types.ObjectId | null;
  clinicId?: Types.ObjectId | null;
  doctorId?: Types.ObjectId | null;
}

export function assertCanReach(
  auth: AuthContext,
  resource: 'pet' | 'appointment' | 'medical_record' | 'user',
  target: OwnershipCheck,
  /* Annotated as the full union — inference from the default would narrow this
     to the literal `'NOT_FOUND'` and reject every more specific code. */
  notFoundCode: ErrorCode = ERROR_CODES.NOT_FOUND,
): void {
  const scope = resolveScope(auth.role, resource);

  if (scope === 'global') return;

  if (scope === 'own') {
    if (target.ownerId && target.ownerId.toString() === auth.userId.toString()) return;
    throw ApiError.notFound(notFoundCode);
  }

  if (scope === 'clinic') {
    /* A doctor may always reach their own rows, even across a clinic move. */
    if (
      auth.role === Role.DOCTOR &&
      target.doctorId &&
      auth.doctorId &&
      target.doctorId.toString() === auth.doctorId.toString()
    ) {
      return;
    }

    if (
      auth.clinicId &&
      target.clinicId &&
      target.clinicId.toString() === auth.clinicId.toString()
    ) {
      return;
    }

    throw ApiError.notFound(notFoundCode);
  }

  throw ApiError.forbidden(ERROR_CODES.INSUFFICIENT_PERMISSION);
}

/** Parse a caller-supplied id, or fail cleanly rather than throwing a CastError. */
export function toObjectId(value: string, field = 'id'): Types.ObjectId {
  if (!Types.ObjectId.isValid(value)) {
    throw ApiError.validation([{ field, message: 'Not a valid id' }]);
  }
  return new Types.ObjectId(value);
}
