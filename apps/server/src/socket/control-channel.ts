import type { Server as HttpServer } from 'node:http';
import { Server as IoServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { resolvePersona } from '../services/personas.js';

interface HandshakeData extends Record<string, unknown> {
  personaId?: string;
}

export type ControlChannel = IoServer;

/**
 * Control-and-execution channel (Socket.IO). Persona authenticated at
 * handshake; Redis adapter keeps rooms coherent across server replicas.
 */
export function createControlChannel(httpServer: HttpServer): ControlChannel {
  const io = new IoServer(httpServer, {
    cors: { origin: env.CLIENT_URL, credentials: true },
  }) as ControlChannel;

  io.use((socket: Socket, next: (err?: Error) => void) => {
    const auth = socket.handshake.auth as HandshakeData | undefined;
    const personaId = auth?.personaId ?? (socket.handshake.query['personaId'] as string | undefined);
    const persona = resolvePersona(personaId ?? null);
    if (!persona) {
      next(new Error('unauthorized: unknown persona'));
      return;
    }
    socket.data.persona = persona;
    next();
  });

  return io;
}

/** Attach a Socket.IO Redis adapter so rooms scale across instances. */
export async function attachRedisAdapter(io: ControlChannel, pub: Redis, sub: Redis): Promise<void> {
  const connects: Promise<unknown>[] = [];
  if (pub.status === 'wait') connects.push(pub.connect());
  if (sub.status === 'wait') connects.push(sub.connect());
  if (connects.length > 0) await Promise.all(connects);

  io.adapter(createAdapter(pub, sub));
}

/** Broadcast notify port implemented on top of Socket.IO rooms. */
export type NotifyEvent =
  | 'file:created'
  | 'file:renamed'
  | 'file:deleted'
  | 'snapshot:created'
  | 'snapshot:rollbackApplied';

export interface RoomNotifier {
  notify(projectId: string, event: NotifyEvent, payload: unknown): void;
}

export class SocketRoomNotifier implements RoomNotifier {
  constructor(private readonly io: ControlChannel) {}

  notify(projectId: string, event: NotifyEvent, payload: unknown): void {
    this.io.to(`project:${projectId}`).emit(event, payload);
  }
}
