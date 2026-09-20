import type { AuditAction } from '../enums.js';
import type { ISODateString, Timestamps, UserId } from './common.js';

/**
 * An immutable record of a privileged action.
 *
 * Written for anything that changes who can do what, touches another person's
 * data, or would need explaining afterwards. The collection is append-only —
 * there is no update or delete path anywhere in the API — and rows age out on a
 * TTL rather than being pruned by hand.
 */
export interface AuditLog extends Timestamps {
  id: string;
  /** Null for system-initiated actions such as the nightly reminder job. */
  actorId: UserId | null;
  actorName: string;
  actorRole: string;
  /** Set when the action was taken while impersonating someone. */
  impersonatorId?: UserId;

  action: AuditAction;
  targetType: string;
  targetId: string;
  targetLabel?: string;

  /** Changed fields only — never the whole document, never a password field. */
  changes?: AuditChange[];

  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  outcome: 'success' | 'failure';
  failureReason?: string;
  occurredAt: ISODateString;
}

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditLogQuery {
  cursor?: string | null;
  limit?: number;
  actorId?: UserId;
  action?: AuditAction;
  targetType?: string;
  targetId?: string;
  from?: ISODateString;
  to?: ISODateString;
  outcome?: 'success' | 'failure';
}
