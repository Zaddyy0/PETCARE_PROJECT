/**
 * Audit log.
 *
 * Append-only by construction: nothing in the API updates or deletes a row
 * here, and the schema's hooks refuse the attempt outright. An audit trail that
 * can be edited by the same privileges it is meant to police is decoration.
 *
 * Written for anything that changes who can do what, reaches into another
 * person's data, or would need explaining after the fact — role changes,
 * suspensions, impersonation, clinical amendments, moderation decisions.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import { AUDIT_ACTIONS, LIMITS, type AuditAction } from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface IAuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface IAuditLog {
  _id: Types.ObjectId;
  /** Null for system-initiated actions such as the nightly reminder sweep. */
  actor?: Types.ObjectId | null;
  actorName: string;
  actorRole: string;
  impersonator?: Types.ObjectId | null;

  action: AuditAction;
  targetType: string;
  targetId: string;
  targetLabel?: string;

  changes: IAuditChange[];

  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  outcome: 'success' | 'failure';
  failureReason?: string;
  occurredAt: Date;
  expiresAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

export type AuditLogDocument = HydratedDocument<IAuditLog>;
export type AuditLogModel = Model<IAuditLog>;

const auditLogSchema = new Schema<IAuditLog, AuditLogModel>(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    /* Denormalised: the actor may later be renamed or deleted, and the log must
       still say who did it at the time. */
    actorName: { type: String, required: true, maxlength: 140 },
    actorRole: { type: String, required: true, maxlength: 40 },
    impersonator: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    action: { type: String, enum: AUDIT_ACTIONS, required: true, index: true },
    targetType: { type: String, required: true, maxlength: 40 },
    targetId: { type: String, required: true, maxlength: 64 },
    targetLabel: { type: String, maxlength: 200 },

    /* Changed fields only — never a whole document, never a credential. */
    changes: {
      type: [
        new Schema<IAuditChange>(
          {
            field: { type: String, required: true, maxlength: 80 },
            from: Schema.Types.Mixed,
            to: Schema.Types.Mixed,
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    ipAddress: { type: String, maxlength: 64 },
    userAgent: { type: String, maxlength: 300 },
    requestId: { type: String, maxlength: 64 },
    outcome: { type: String, enum: ['success', 'failure'], default: 'success', index: true },
    failureReason: { type: String, maxlength: 300 },
    occurredAt: { type: Date, required: true, default: Date.now },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + LIMITS.AUDIT_RETENTION_DAYS * 86_400_000),
    },
  },
  { timestamps: true, minimize: false },
);

auditLogSchema.index({ occurredAt: -1 });
auditLogSchema.index({ actor: 1, occurredAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1, occurredAt: -1 });
auditLogSchema.index({ action: 1, occurredAt: -1 });
/* Two years, then Mongo expires the row on its own. */
auditLogSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'audit_ttl' });

/**
 * Enforce append-only at the schema level.
 *
 * Belt and braces alongside "there is no update route": a future contributor
 * who adds one gets an immediate, explicit failure rather than silently
 * rewriting history.
 */
function refuseMutation(next: (error?: Error) => void) {
  next(new Error('Audit log entries are immutable and cannot be updated or deleted.'));
}

auditLogSchema.pre('updateOne', refuseMutation);
auditLogSchema.pre('updateMany', refuseMutation);
auditLogSchema.pre('findOneAndUpdate', refuseMutation);
auditLogSchema.pre('deleteOne', refuseMutation);
auditLogSchema.pre('deleteMany', refuseMutation);

applyStandardTransform(auditLogSchema);

export const AuditLog = (mongoose.models['AuditLog'] as AuditLogModel) ??
  mongoose.model<IAuditLog>('AuditLog', auditLogSchema);
