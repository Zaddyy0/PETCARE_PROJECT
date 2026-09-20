import type { NotificationChannel, NotificationType } from '../enums.js';
import type { ISODateString, NotificationId, Timestamps, UserId } from './common.js';

export interface Notification extends Timestamps {
  id: NotificationId;
  userId: UserId;
  type: NotificationType;
  title: string;
  body: string;
  /**
   * Structured payload for deep-linking — `{ appointmentId, petId }` and the
   * like. Kept as loose data rather than a URL so the client decides routing;
   * a stored `/app/appointments/123` breaks the day routes change.
   */
  data: Record<string, unknown>;
  /** Client-side route the bell item navigates to. */
  actionUrl?: string;
  readAt: ISODateString | null;
  channels: NotificationChannel[];
  /** Governs the styling of the toast and the bell row. */
  priority: 'low' | 'normal' | 'high';
  /** TTL anchor — Mongo drops the row itself once this passes. */
  expiresAt?: ISODateString;
}

export interface NotificationListQuery {
  cursor?: string | null;
  limit?: number;
  unreadOnly?: boolean;
  type?: NotificationType;
}

export interface NotificationCounts {
  total: number;
  unread: number;
}

/* -------------------------------------------------------------------------- */
/*                              Realtime protocol                             */
/* -------------------------------------------------------------------------- */

/**
 * Server → client socket events.
 *
 * Naming every event and its payload here means the socket layer is as
 * type-checked as the REST layer. An untyped `socket.emit('thing', blob)` is
 * how realtime features rot.
 */
export interface ServerToClientEvents {
  'notification:new': (notification: Notification) => void;
  'notification:counts': (counts: NotificationCounts) => void;
  'appointment:created': (payload: AppointmentRealtimePayload) => void;
  'appointment:updated': (payload: AppointmentRealtimePayload) => void;
  'appointment:cancelled': (payload: AppointmentRealtimePayload) => void;
  'doctor:availability_changed': (payload: { doctorId: string }) => void;
  'presence:update': (payload: { userId: string; online: boolean }) => void;
  'session:revoked': (payload: { reason: string }) => void;
}

export interface ClientToServerEvents {
  /** Subscribe to a doctor's calendar; server checks authorisation first. */
  'calendar:subscribe': (payload: { doctorId: string }) => void;
  'calendar:unsubscribe': (payload: { doctorId: string }) => void;
  'notification:mark_read': (payload: { notificationId: string }) => void;
  'notification:mark_all_read': () => void;
}

export interface AppointmentRealtimePayload {
  appointmentId: string;
  doctorId: string;
  clientId: string;
  clinicId: string;
  petId: string;
  slotStart: ISODateString;
  status: string;
}

/**
 * Socket room naming.
 *
 * Rooms are the authorization boundary for realtime: a client joins only their
 * own user room, a doctor additionally joins their doctor room, staff join the
 * clinic room. Emitting to a room is then automatically scoped — there is no
 * broadcast path that could reach the wrong tenant.
 */
export const SocketRoom = {
  user: (userId: string) => `user:${userId}`,
  doctor: (doctorId: string) => `doctor:${doctorId}`,
  clinic: (clinicId: string) => `clinic:${clinicId}`,
  platform: () => 'platform',
} as const;
