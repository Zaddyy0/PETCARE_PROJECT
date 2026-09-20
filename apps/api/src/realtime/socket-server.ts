/**
 * Socket.IO server.
 *
 * The important part is that **a socket connection is authenticated exactly as
 * carefully as an HTTP request.** A websocket that only checks a JWT signature
 * at connect time and then trusts whatever the client asks to subscribe to is a
 * straightforward way to leak another clinic's calendar — the REST API's
 * authorization simply does not apply here, so it has to be repeated.
 *
 * Two rules:
 *
 *   1. The handshake verifies the token, loads the user, and checks the session
 *      is live — the same checks `authenticate` middleware performs.
 *   2. Room joins are assigned by the *server* from the authenticated identity.
 *      A client cannot ask to join a room; it can only ask to subscribe to a
 *      doctor's calendar, and that request is authorised before it is honoured.
 */

import type http from 'node:http';
import { Server } from 'socket.io';
import { Types } from 'mongoose';
import {
  Role,
  SocketRoom,
  UserStatus,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@pawsitive/shared';
import { env } from '../config/env.js';
import { createLogger } from '../config/logger.js';
import { Doctor } from '../models/doctor.model.js';
import { User } from '../models/user.model.js';
import { isSessionActive, verifyAccessToken } from '../services/token.service.js';
import { markAllRead, markRead } from '../services/notification.service.js';
import { registerSocketServer, clearSocketServer, type TypedServer } from './emitter.js';

const log = createLogger('socket');

interface SocketIdentity {
  userId: Types.ObjectId;
  role: Role;
  clinicId: Types.ObjectId | null;
  doctorId: Types.ObjectId | null;
}

/** Per-connection state, keyed by socket id. */
const identities = new Map<string, SocketIdentity>();

export function createSocketServer(httpServer: http.Server): TypedServer | null {
  if (!env.ENABLE_REALTIME) {
    log.info('Realtime is disabled (ENABLE_REALTIME=false)');
    return null;
  }

  const io: TypedServer = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: env.CORS_ORIGINS,
      credentials: true,
    },
    /* Drop a client that has not answered two pings — otherwise a laptop that
       went to sleep holds a room slot indefinitely. */
    pingInterval: 25_000,
    pingTimeout: 20_000,
    /* Small: these are events, not file transfers. */
    maxHttpBufferSize: 64 * 1024,
    transports: ['websocket', 'polling'],
  });

  /* ---------------------------------------------------------------------- */
  /*  Handshake authentication.                                             */
  /* ---------------------------------------------------------------------- */
  io.use(async (socket, next) => {
    try {
      /* The token comes through `auth`, not a query parameter — query strings
         end up in proxy and server access logs. */
      const token = socket.handshake.auth?.['token'] as string | undefined;

      if (!token) {
        next(new Error('UNAUTHENTICATED'));
        return;
      }

      const claims = verifyAccessToken(token);

      if (!Types.ObjectId.isValid(claims.sub)) {
        next(new Error('TOKEN_INVALID'));
        return;
      }

      if (!(await isSessionActive(claims.sid))) {
        next(new Error('SESSION_REVOKED'));
        return;
      }

      const user = await User.findById(claims.sub).select('role clinic status').lean();

      if (!user || user.status !== UserStatus.ACTIVE) {
        next(new Error('UNAUTHENTICATED'));
        return;
      }

      let doctorId: Types.ObjectId | null = null;
      if (user.role === Role.DOCTOR) {
        const profile = await Doctor.findOne({ user: user._id }).select('_id').lean();
        doctorId = profile?._id ?? null;
      }

      identities.set(socket.id, {
        userId: user._id,
        /* Read from the database, not the token — a demoted user must not keep
           their old room access for the life of their JWT. */
        role: user.role,
        clinicId: user.clinic ?? null,
        doctorId,
      });

      next();
    } catch (error) {
      log.debug({ err: error }, 'Socket handshake rejected');
      next(new Error('UNAUTHENTICATED'));
    }
  });

  /* ---------------------------------------------------------------------- */
  /*  Connection lifecycle.                                                 */
  /* ---------------------------------------------------------------------- */
  io.on('connection', (socket) => {
    const identity = identities.get(socket.id);

    if (!identity) {
      socket.disconnect(true);
      return;
    }

    /**
     * Rooms are assigned here, from the authenticated identity.
     *
     * The client never names a room. This is the whole authorization model for
     * realtime — everything emitted is scoped to rooms, so if joins are correct
     * then delivery is correct by construction.
     */
    void socket.join(SocketRoom.user(identity.userId.toString()));

    if (identity.doctorId) {
      void socket.join(SocketRoom.doctor(identity.doctorId.toString()));
    }

    /* Clinic-wide traffic is for staff only — a client must not see the
       clinic's whole calendar. */
    if (identity.clinicId && identity.role !== Role.CLIENT) {
      void socket.join(SocketRoom.clinic(identity.clinicId.toString()));
    }

    if (identity.role === Role.SUPER_ADMIN) {
      void socket.join(SocketRoom.platform());
    }

    log.debug(
      { userId: identity.userId.toString(), role: identity.role, socketId: socket.id },
      'Socket connected',
    );

    /* ---- Subscribing to a doctor's calendar. --------------------------- */
    socket.on('calendar:subscribe', ({ doctorId }) => {
      if (!Types.ObjectId.isValid(doctorId)) return;

      void (async () => {
        if (await canWatchDoctor(identity, doctorId)) {
          await socket.join(SocketRoom.doctor(doctorId));
        } else {
          log.warn(
            { userId: identity.userId.toString(), doctorId },
            'Rejected calendar subscription outside the caller’s scope',
          );
        }
      })();
    });

    socket.on('calendar:unsubscribe', ({ doctorId }) => {
      if (!Types.ObjectId.isValid(doctorId)) return;
      /* Never let a client leave their *own* doctor room this way — they would
         stop receiving their own appointment updates. */
      if (identity.doctorId?.toString() === doctorId) return;

      void socket.leave(SocketRoom.doctor(doctorId));
    });

    socket.on('notification:mark_read', ({ notificationId }) => {
      if (!Types.ObjectId.isValid(notificationId)) return;
      void markRead(identity.userId, new Types.ObjectId(notificationId));
    });

    socket.on('notification:mark_all_read', () => {
      void markAllRead(identity.userId);
    });

    socket.on('disconnect', (reason) => {
      identities.delete(socket.id);
      log.debug({ socketId: socket.id, reason }, 'Socket disconnected');
    });
  });

  registerSocketServer(io);
  log.info('Realtime server ready');

  return io;
}

/**
 * May this identity watch a given doctor's calendar?
 *
 * Staff may watch anyone in their own clinic; a super admin may watch anyone.
 * A client may not watch a calendar at all — they see their own appointments
 * through their user room, which is all they are entitled to. Letting a client
 * subscribe to a doctor would expose every other client's booked times.
 */
async function canWatchDoctor(identity: SocketIdentity, doctorId: string): Promise<boolean> {
  if (identity.role === Role.SUPER_ADMIN) return true;
  if (identity.role === Role.CLIENT) return false;
  if (identity.doctorId?.toString() === doctorId) return true;
  if (!identity.clinicId) return false;

  const doctor = await Doctor.findById(doctorId).select('clinic').lean();
  return doctor?.clinic?.toString() === identity.clinicId.toString();
}

export async function closeSocketServer(io: TypedServer | null): Promise<void> {
  if (!io) return;

  clearSocketServer();
  identities.clear();

  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });

  log.info('Realtime server closed');
}
