/**
 * Audit logging.
 *
 * Called for anything that changes who can do what, reaches into another
 * person's data, or would need explaining afterwards.
 *
 * Two design rules:
 *
 *   • **Never block the caller.** An audit write failing must not fail the
 *     action it describes — a database hiccup should not stop an admin from
 *     suspending an abusive account. Failures are logged loudly instead.
 *
 *   • **Record the diff, not the document.** Storing whole before/after copies
 *     bloats the collection and eventually captures a field that should never
 *     have been persisted twice. We store changed fields only, and scrub
 *     anything credential-shaped on the way in.
 */

import type { Request } from 'express';
import { Types } from 'mongoose';
import type { AuditAction } from '@pawsitive/shared';
import { createLogger } from '../config/logger.js';
import { AuditLog, type IAuditChange } from '../models/audit-log.model.js';

const log = createLogger('audit');

/**
 * Field names never written to the audit trail.
 *
 * An audit log is read by more people than the database is, and retained for
 * two years. A password hash captured in a "user.updated" diff is a credential
 * sitting in the most-read collection on the platform.
 */
const NEVER_AUDIT = new Set([
  'passwordHash',
  'passwordHistory',
  'password',
  'passwordResetTokenHash',
  'inviteTokenHash',
  'emailVerificationTokenHash',
  'tokenHash',
  'refreshToken',
  '__v',
  'updatedAt',
]);

export interface AuditActor {
  id: Types.ObjectId | null;
  name: string;
  role: string;
  impersonatorId?: Types.ObjectId | null;
}

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  targetType: string;
  targetId: string | Types.ObjectId;
  targetLabel?: string;
  changes?: IAuditChange[];
  outcome?: 'success' | 'failure';
  failureReason?: string;
  request?: Pick<Request, 'ip' | 'requestId'> & { get?: (name: string) => string | undefined };
}

/**
 * Write an audit entry.
 *
 * Deliberately **not** awaited by most callers — it is fire-and-forget. The
 * promise is returned so tests can await it, but a controller should not make
 * a user wait on a write they will never see.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await AuditLog.create({
      actor: entry.actor.id,
      actorName: entry.actor.name,
      actorRole: entry.actor.role,
      impersonator: entry.actor.impersonatorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId.toString(),
      ...(entry.targetLabel ? { targetLabel: entry.targetLabel } : {}),
      changes: entry.changes ?? [],
      outcome: entry.outcome ?? 'success',
      ...(entry.failureReason ? { failureReason: entry.failureReason } : {}),
      ...(entry.request?.ip ? { ipAddress: entry.request.ip } : {}),
      ...(entry.request?.get?.('user-agent')
        ? { userAgent: entry.request.get('user-agent') }
        : {}),
      ...(entry.request?.requestId ? { requestId: entry.request.requestId } : {}),
      occurredAt: new Date(),
    });
  } catch (error) {
    /* Swallowed on purpose — see the file header. Logged at `error` so it is
       still visible and alertable. */
    log.error(
      { err: error, action: entry.action, targetId: entry.targetId.toString() },
      'Failed to write audit entry',
    );
  }
}

/**
 * Compute the changed fields between two states.
 *
 * Only keys present in `next` are considered, so a partial update does not
 * report every untouched field as "changed to undefined".
 */
export function diffFields(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): IAuditChange[] {
  const changes: IAuditChange[] = [];

  for (const [field, to] of Object.entries(next)) {
    if (NEVER_AUDIT.has(field)) continue;

    const from = previous[field];
    if (isEqual(from, to)) continue;

    changes.push({ field, from: sanitise(from), to: sanitise(to) });
  }

  return changes;
}

/**
 * Structural comparison, deep enough for the shapes we audit.
 *
 * `JSON.stringify` would be shorter but is key-order sensitive, so reordering
 * an object's keys would look like a change and fill the log with noise.
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Types.ObjectId || b instanceof Types.ObjectId) {
    return String(a) === String(b);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => isEqual(item, b[index]));
  }

  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as object);
    const bKeys = Object.keys(b as object);
    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every((key) =>
      isEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }

  return false;
}

/** Make a value safe and compact enough to store. */
function sanitise(value: unknown): unknown {
  if (value instanceof Types.ObjectId) return value.toString();
  if (value instanceof Date) return value.toISOString();

  /* Cap long strings: a 5000-character clinical note does not belong in the
     diff, and the record itself already holds it. */
  if (typeof value === 'string' && value.length > 200) {
    return `${value.slice(0, 200)}… (${value.length} chars)`;
  }

  return value;
}

/** Build an actor from the request context. */
export function actorFromRequest(req: Request): AuditActor {
  const user = req.currentUser;

  if (!user || !req.auth) {
    return { id: null, name: 'anonymous', role: 'none' };
  }

  return {
    id: req.auth.userId,
    name: `${user.firstName} ${user.lastName}`.trim(),
    role: req.auth.role,
    impersonatorId: req.auth.impersonatorId,
  };
}

/** The actor for work done by a scheduled job rather than a person. */
export const SYSTEM_ACTOR: AuditActor = {
  id: null,
  name: 'system',
  role: 'system',
};
