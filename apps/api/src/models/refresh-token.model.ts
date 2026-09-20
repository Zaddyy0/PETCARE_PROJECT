/**
 * Refresh tokens, with rotation and reuse detection.
 *
 * The previous system issued one long-lived JWT, stored it in `localStorage`,
 * and had no way to revoke it. That has three problems: any XSS payload can
 * read it, a stolen token stays valid until it expires, and signing a user out
 * everywhere is impossible.
 *
 * What replaces it:
 *
 *   • The **access token** is a short-lived (15 min) JWT held in memory by the
 *     web client. It is never written to storage, so script injection has a
 *     15-minute window at worst rather than permanent access.
 *
 *   • The **refresh token** is a random opaque string in an httpOnly cookie —
 *     unreadable from JavaScript by construction — and it is stored here,
 *     hashed, so it can be revoked.
 *
 *   • **Rotation:** each refresh consumes its token and issues a new one.
 *
 *   • **Reuse detection:** because a rotated token is single-use, a second
 *     presentation of one is evidence it was stolen — the legitimate client
 *     already spent it. We cannot tell attacker from victim, so we revoke the
 *     entire family and force a fresh sign-in. This is the standard defence,
 *     and it turns silent, indefinite account access into one failed request.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';

export interface IRefreshToken {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** SHA-256 HMAC of the token. The plaintext exists only in the user's cookie. */
  tokenHash: string;
  /** Groups every token descended from one sign-in, so a family can be revoked together. */
  family: string;
  /** JWT `sid` claim, tying an access token to this session. */
  sessionId: string;

  expiresAt: Date;
  /** Set when this token was exchanged for a successor. */
  rotatedAt?: Date | null;
  replacedBy?: string | null;

  revokedAt?: Date | null;
  revokedReason?: 'logout' | 'rotation' | 'reuse_detected' | 'admin' | 'password_change' | null;

  /* Captured for the "your sessions" screen and for anomaly review. */
  userAgent?: string;
  ipAddress?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type RefreshTokenDocument = HydratedDocument<IRefreshToken>;
export type RefreshTokenModel = Model<IRefreshToken>;

const refreshTokenSchema = new Schema<IRefreshToken, RefreshTokenModel>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    sessionId: { type: String, required: true, index: true },

    expiresAt: { type: Date, required: true },
    rotatedAt: { type: Date, default: null },
    replacedBy: { type: String, default: null },

    revokedAt: { type: Date, default: null },
    revokedReason: {
      type: String,
      enum: ['logout', 'rotation', 'reuse_detected', 'admin', 'password_change', null],
      default: null,
    },

    userAgent: { type: String, maxlength: 300 },
    ipAddress: { type: String, maxlength: 64 },
  },
  { timestamps: true },
);

/* Active sessions for a user — powers "sign out everywhere". */
refreshTokenSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });

/**
 * Expired tokens remove themselves.
 *
 * Note the grace period: the row lingers a little past expiry so that a reuse
 * attempt just after the deadline is still recognised as reuse rather than
 * looking like an unknown token.
 */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86_400, name: 'refresh_ttl' });

/** Is this token currently usable? */
refreshTokenSchema.methods['isActive'] = function isActive(this: RefreshTokenDocument): boolean {
  return !this.revokedAt && !this.rotatedAt && this.expiresAt.getTime() > Date.now();
};

export const RefreshToken = (mongoose.models['RefreshToken'] as RefreshTokenModel) ??
  mongoose.model<IRefreshToken>('RefreshToken', refreshTokenSchema);
