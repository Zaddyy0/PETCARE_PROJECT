/**
 * Realtime emitter.
 *
 * A thin indirection over the Socket.IO server, for one reason: services should
 * be able to announce that something happened without caring whether realtime
 * is switched on, whether the socket server has finished starting, or whether
 * this process is a worker with no HTTP server at all.
 *
 * Every emit here is a no-op when no server is registered. That is what lets
 * `ENABLE_REALTIME=false` be a genuine switch rather than a source of crashes,
 * and lets tests exercise the services without standing up a socket layer.
 */

import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@pawsitive/shared';
import { createLogger } from '../config/logger.js';

const log = createLogger('realtime');

export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: TypedServer | null = null;

export function registerSocketServer(server: TypedServer): void {
  io = server;
}

export function clearSocketServer(): void {
  io = null;
}

export function getSocketServer(): TypedServer | null {
  return io;
}

/**
 * Emit to a room.
 *
 * Rooms are the authorization boundary: a user joins only their own user room,
 * a doctor additionally their doctor room, clinic staff their clinic room. So
 * an emit is automatically scoped and there is no path that delivers one
 * tenant's data to another.
 *
 * Errors are swallowed. A socket failure must never break the HTTP request that
 * triggered it — the appointment is already booked; failing the response
 * because a websocket frame did not send would be absurd.
 */
export function emitToRoom<TEvent extends keyof ServerToClientEvents>(
  room: string,
  event: TEvent,
  ...args: Parameters<ServerToClientEvents[TEvent]>
): void {
  if (!io) return;

  try {
    io.to(room).emit(event, ...args);
  } catch (error) {
    log.error({ err: error, room, event }, 'Failed to emit realtime event');
  }
}

/** Emit the same event to several rooms, de-duplicated. */
export function emitToRooms<TEvent extends keyof ServerToClientEvents>(
  rooms: string[],
  event: TEvent,
  ...args: Parameters<ServerToClientEvents[TEvent]>
): void {
  if (!io) return;

  const unique = [...new Set(rooms.filter(Boolean))];
  if (unique.length === 0) return;

  try {
    /* `to()` with an array delivers once per socket even when a socket belongs
       to several of the rooms — so a doctor who is also clinic staff does not
       receive the same event twice. */
    io.to(unique).emit(event, ...args);
  } catch (error) {
    log.error({ err: error, rooms: unique, event }, 'Failed to emit realtime event');
  }
}

/** How many clients are currently connected. Feeds the health metrics tile. */
export function connectionCount(): number {
  return io?.engine?.clientsCount ?? 0;
}
