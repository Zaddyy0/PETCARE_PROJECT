import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  type ClientToServerEvents,
  type Notification,
  type NotificationCounts,
  type ServerToClientEvents,
} from '@pawsitive/shared';
import { baseApi } from '../api/baseApi';
import { notificationApi } from '../api/notificationApi';
import { useAppDispatch, useAppSelector } from '../hooks';
import { selectAccessToken, selectIsAuthenticated } from '../slices/authSlice';
import { toastPushed } from '../slices/toastSlice';

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * The single live socket, held at module scope.
 *
 * There is exactly one connection per tab, owned by `useRealtime`. Other hooks
 * need to *emit* on it — subscribing to a doctor's calendar, for instance — and
 * a module-level handle is the honest way to share it. The alternative, a
 * context provider, would add a tree wrapper for a value that is a genuine
 * singleton and is never read during render.
 */
let liveSocket: TypedSocket | null = null;

/** Queued subscriptions, replayed after a reconnect. */
const watchedDoctors = new Set<string>();

/**
 * The realtime connection.
 *
 * Mounted once, from the authenticated shell. Everything it receives is pushed
 * into the **RTK Query cache** rather than into component state — so a booking
 * that arrives over the socket updates the calendar, the list and the badge
 * counts through the same cache every component already reads. There is no
 * second source of truth to keep in sync.
 *
 * Three things this has to get right:
 *
 *   • **Reconnect with a fresh token.** The handshake is authenticated, and the
 *     access token expires every 15 minutes. The socket is therefore recreated
 *     when the token changes, not created once and left holding a dead
 *     credential.
 *
 *   • **Invalidate, do not patch, for anything shared.** A new appointment
 *     affects list membership, pagination totals and slot availability. Patching
 *     the cache by hand would mean reimplementing the server's filtering and
 *     sorting on the client; invalidating the tag lets RTK Query refetch
 *     exactly the queries that are actually mounted.
 *
 *   • **Patch, do not invalidate, for notifications.** Those arrive one at a
 *     time and belong at the head of a list we already hold, so a targeted
 *     insert avoids a round trip per notification.
 */
export function useRealtime(): void {
  const dispatch = useAppDispatch();
  const authenticated = useAppSelector(selectIsAuthenticated);
  const accessToken = useAppSelector(selectAccessToken);

  const socketRef = useRef<TypedSocket | null>(null);

  useEffect(() => {
    if (!authenticated || !accessToken) return;

    /**
     * `path` is default, but the URL is deliberately relative.
     *
     * In development Vite proxies `/socket.io` with `ws: true`; in production
     * the client is served from the same origin as the API. Either way the
     * connection is same-origin, which keeps the session cookie first-party.
     */
    const socket: TypedSocket = io({
      /* Not a query parameter: query strings end up in proxy and server access
         logs, and this is a bearer credential. */
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      /* Bounded backoff. Without a cap, a server restart has every client
         retrying every few hundred milliseconds. */
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
      reconnectionAttempts: Infinity,
      /* A stale handshake must not be reused after the token rotates. */
      forceNew: true,
    });

    socketRef.current = socket;
    liveSocket = socket;

    /**
     * Re-subscribe on every connect, not just the first.
     *
     * Room membership lives on the server and is lost when the connection
     * drops. Without replaying it, a brief network blip leaves the schedule
     * view silently no longer receiving updates — which looks exactly like
     * nothing happening.
     */
    socket.on('connect', () => {
      for (const doctorId of watchedDoctors) {
        socket.emit('calendar:subscribe', { doctorId });
      }
    });

    /* ---- Notifications: patch the cache directly. --------------------- */
    socket.on('notification:new', (notification: Notification) => {
      dispatch(
        notificationApi.util.updateQueryData('listNotifications', undefined, (draft) => {
          /* Guard against a duplicate: a reconnect can redeliver, and the
             same event may arrive while a refetch is already in flight. */
          if (draft.items.some((item) => item.id === notification.id)) return;
          draft.items.unshift(notification);
        }),
      );

      /* A high-priority notification also gets a toast — a cancellation or an
         imminent appointment should not wait for the user to open the bell. */
      if (notification.priority === 'high') {
        dispatch(
          toastPushed({
            tone: notification.type.includes('cancelled') ? 'warning' : 'info',
            title: notification.title,
            description: notification.body,
            ...(notification.actionUrl
              ? { action: { label: 'View', href: notification.actionUrl } }
              : {}),
          }),
        );
      }
    });

    socket.on('notification:counts', (counts: NotificationCounts) => {
      dispatch(
        notificationApi.util.updateQueryData('getNotificationCounts', undefined, (draft) => {
          draft.total = counts.total;
          draft.unread = counts.unread;
        }),
      );
    });

    /* ---- Appointments: invalidate and let the cache refetch. ---------- */
    const invalidateBooking = () => {
      dispatch(
        baseApi.util.invalidateTags([
          { type: 'Appointment', id: 'LIST' },
          'Calendar',
          'Slots',
          'Analytics',
        ]),
      );
    };

    socket.on('appointment:created', invalidateBooking);
    socket.on('appointment:updated', invalidateBooking);
    socket.on('appointment:cancelled', invalidateBooking);

    socket.on('doctor:availability_changed', ({ doctorId }) => {
      dispatch(baseApi.util.invalidateTags([{ type: 'Slots', id: doctorId }]));
    });

    /**
     * The server revoked this session — a suspension, a password change, or a
     * sign-out on another device. Nothing to do here but tell the user; the
     * next HTTP request will 401 and the base query signs them out.
     */
    socket.on('session:revoked', ({ reason }) => {
      dispatch(
        toastPushed({
          tone: 'warning',
          title: 'Your session ended',
          description: reason,
          duration: null,
        }),
      );
    });

    return () => {
      /* Every listener is removed before disconnecting. Socket.IO reuses the
         underlying manager across instances, so a leaked listener would fire
         again on the next connection — and dispatch into an unmounted tree. */
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      liveSocket = null;
    };
    /* Re-runs when the token rotates, which is what keeps the handshake
       credential fresh. */
  }, [authenticated, accessToken, dispatch]);
}

/**
 * Subscribe to a doctor's calendar for as long as the component is mounted.
 *
 * The server authorises the request — clinic staff may watch anyone in their
 * clinic, a client may not watch a calendar at all — so an unauthorised
 * subscribe is simply ignored rather than erroring.
 */
export function useDoctorCalendarSubscription(doctorId: string | null | undefined): void {
  const authenticated = useAppSelector(selectIsAuthenticated);

  useEffect(() => {
    if (!authenticated || !doctorId) return;

    /* Recorded before emitting, so a reconnect replays it even if the socket
       is momentarily down right now. */
    watchedDoctors.add(doctorId);
    liveSocket?.emit('calendar:subscribe', { doctorId });

    return () => {
      watchedDoctors.delete(doctorId);
      liveSocket?.emit('calendar:unsubscribe', { doctorId });
    };
  }, [authenticated, doctorId]);
}
