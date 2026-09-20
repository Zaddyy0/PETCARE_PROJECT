/**
 * Notifications.
 *
 * One entry point, `notify()`, fans out to every channel the user has enabled:
 * a stored in-app row, a realtime socket push, and optionally an email. Callers
 * say *what happened*, not *how to tell someone* — so adding a channel later
 * (push, SMS) touches this file and nothing else.
 *
 * Like audit writes, this never throws into the caller. Failing to send a
 * "your appointment is confirmed" notification must not un-confirm the
 * appointment.
 */

import { Types } from 'mongoose';
import {
  NotificationType,
  SocketRoom,
  type NotificationChannel,
  type NotificationCounts,
  type NotificationType as NotificationTypeType,
} from '@pawsitive/shared';
import { createLogger } from '../config/logger.js';
import { toNotificationDTO } from '../dto/notification.dto.js';
import { Notification } from '../models/notification.model.js';
import { User } from '../models/user.model.js';
import { emitToRoom } from '../realtime/emitter.js';
import { sendEmail, type EmailMessage } from './email.service.js';

const log = createLogger('notifications');

export interface NotifyInput {
  userId: Types.ObjectId;
  type: NotificationTypeType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  actionUrl?: string;
  priority?: 'low' | 'normal' | 'high';
  /** Built lazily so the template is only rendered if email is actually wanted. */
  email?: (recipient: { email: string; name: string }) => EmailMessage;
}

/**
 * Which preference flag governs a given notification type.
 *
 * Mapped explicitly rather than inferred from the type name: a new type with no
 * entry falls through to `null`, meaning "always deliver". That is the right
 * default for things like a suspension notice, which a user should not be able
 * to opt out of.
 */
const PREFERENCE_BY_TYPE: Partial<Record<NotificationTypeType, 'appointmentReminders' | 'vaccinationReminders' | 'marketing'>> = {
  [NotificationType.APPOINTMENT_REMINDER]: 'appointmentReminders',
  [NotificationType.VACCINATION_DUE]: 'vaccinationReminders',
  [NotificationType.SYSTEM_ANNOUNCEMENT]: 'marketing',
};

export async function notify(input: NotifyInput): Promise<void> {
  try {
    const user = await User.findById(input.userId)
      .select('email firstName lastName notificationPreferences status')
      .lean();

    if (!user) {
      log.warn({ userId: input.userId.toString() }, 'Notification target no longer exists');
      return;
    }

    /* A deactivated account should not keep receiving mail. */
    if (user.status === 'deactivated') return;

    const preferences = user.notificationPreferences;
    const gate = PREFERENCE_BY_TYPE[input.type];

    /* The user has opted out of this category entirely. */
    if (gate && !preferences[gate]) return;

    const channels: NotificationChannel[] = [];
    if (preferences.inApp) channels.push('in_app');

    const wantsEmail = Boolean(input.email) && preferences.email;
    if (wantsEmail) channels.push('email');

    if (channels.length === 0) return;

    /* ---- In-app row + realtime push. ----------------------------------- */
    if (preferences.inApp) {
      const notification = await Notification.create({
        user: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? {},
        ...(input.actionUrl ? { actionUrl: input.actionUrl } : {}),
        channels,
        priority: input.priority ?? 'normal',
      });

      const dto = toNotificationDTO(notification);

      /* Scoped to the recipient's own room — there is no broadcast path that
         could deliver someone else's notification. */
      emitToRoom(SocketRoom.user(input.userId.toString()), 'notification:new', dto);
      void pushCounts(input.userId);
    }

    /* ---- Email. --------------------------------------------------------- */
    if (wantsEmail && input.email) {
      const message = input.email({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`.trim(),
      });

      await sendEmail(message);
    }
  } catch (error) {
    log.error(
      { err: error, userId: input.userId.toString(), type: input.type },
      'Failed to deliver notification',
    );
  }
}

/** Notify several users of the same thing, concurrently. */
export async function notifyMany(inputs: NotifyInput[]): Promise<void> {
  await Promise.allSettled(inputs.map((input) => notify(input)));
}

export async function getCounts(userId: Types.ObjectId): Promise<NotificationCounts> {
  const [total, unread] = await Promise.all([
    Notification.countDocuments({ user: userId }),
    /* Served by the partial `unread_count` index, so this stays cheap however
       much history the user accumulates. */
    Notification.countDocuments({ user: userId, readAt: null }),
  ]);

  return { total, unread };
}

/** Push fresh counts so the bell badge updates without a refetch. */
async function pushCounts(userId: Types.ObjectId): Promise<void> {
  try {
    const counts = await getCounts(userId);
    emitToRoom(SocketRoom.user(userId.toString()), 'notification:counts', counts);
  } catch (error) {
    log.error({ err: error }, 'Failed to push notification counts');
  }
}

export async function markRead(
  userId: Types.ObjectId,
  notificationId: Types.ObjectId,
): Promise<boolean> {
  /* Scoped to the owner, so a guessed id cannot mark someone else's row read. */
  const result = await Notification.updateOne(
    { _id: notificationId, user: userId, readAt: null },
    { $set: { readAt: new Date() } },
  );

  if (result.modifiedCount > 0) {
    void pushCounts(userId);
    return true;
  }

  return false;
}

export async function markAllRead(userId: Types.ObjectId): Promise<number> {
  const result = await Notification.updateMany(
    { user: userId, readAt: null },
    { $set: { readAt: new Date() } },
  );

  if (result.modifiedCount > 0) {
    void pushCounts(userId);
  }

  return result.modifiedCount;
}
