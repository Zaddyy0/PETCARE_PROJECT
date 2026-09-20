/**
 * In-app notifications.
 *
 * This collection grows faster than any other — several rows per appointment
 * per user — and nobody reads a notification from four months ago. A TTL index
 * lets MongoDB expire them itself, so there is no cleanup job to write, monitor
 * or forget to run.
 */

import mongoose, { Schema, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  LIMITS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType as NotificationTypeType,
} from '@pawsitive/shared';
import { applyStandardTransform } from './serialize.js';

export interface INotification {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: NotificationTypeType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  actionUrl?: string;
  readAt?: Date | null;
  channels: NotificationChannel[];
  priority: 'low' | 'normal' | 'high';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NotificationDocument = HydratedDocument<INotification>;
export type NotificationModel = Model<INotification>;

const notificationSchema = new Schema<INotification, NotificationModel>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, trim: true, maxlength: 140 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    /* Deep-link payload — ids, not a pre-built URL, so routing can change. */
    data: { type: Schema.Types.Mixed, default: {} },
    actionUrl: { type: String, trim: true, maxlength: 300 },
    readAt: { type: Date, default: null },
    channels: { type: [String], enum: NOTIFICATION_CHANNELS, default: ['in_app'] },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + LIMITS.NOTIFICATION_RETENTION_DAYS * 86_400_000),
    },
  },
  { timestamps: true, minimize: false },
);

/* The bell dropdown: this user's notifications, newest first. */
notificationSchema.index({ user: 1, createdAt: -1 });

/**
 * The unread badge count.
 *
 * Partial on unread rows only, so the index holds a handful of documents per
 * user rather than every notification ever sent to them. Counting unreads stays
 * constant-ish as history grows.
 */
notificationSchema.index(
  { user: 1, readAt: 1 },
  { partialFilterExpression: { readAt: null }, name: 'unread_count' },
);

/** Mongo deletes the document once `expiresAt` passes. No cleanup job needed. */
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'notification_ttl' });

applyStandardTransform(notificationSchema);

export const Notification = (mongoose.models['Notification'] as NotificationModel) ??
  mongoose.model<INotification>('Notification', notificationSchema);
