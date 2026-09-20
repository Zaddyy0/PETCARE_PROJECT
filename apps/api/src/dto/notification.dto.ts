import type { Types } from 'mongoose';
import type { Notification as NotificationDTO } from '@pawsitive/shared';
import type { INotification } from '../models/notification.model.js';

type NotificationLike = INotification & { _id: Types.ObjectId };

export function toNotificationDTO(notification: NotificationLike): NotificationDTO {
  const dto: NotificationDTO = {
    id: notification._id.toString(),
    userId: notification.user.toString(),
    type: notification.type,
    title: notification.title,
    body: notification.body,
    data: { ...notification.data },
    readAt: notification.readAt ? notification.readAt.toISOString() : null,
    channels: [...notification.channels],
    priority: notification.priority,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };

  if (notification.actionUrl) dto.actionUrl = notification.actionUrl;
  if (notification.expiresAt) dto.expiresAt = notification.expiresAt.toISOString();

  return dto;
}
