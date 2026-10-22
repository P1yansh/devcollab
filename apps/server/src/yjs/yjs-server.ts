import http from 'node:http';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocketServer } from 'ws';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import type { Role } from '@devcollab/shared';
import { classifyIncomingMessage, canPersonaWrite, MESSAGE_SYNC, MESSAGE_AWARENESS } from './protocol-detect.js';
import type { RoomManager } from './room-manager.js';
import { Room } from './room.js';
import type { MembershipStore } from '../store/types.js';
import { resolvePersona } from '../services/personas.js';

interface WSConn {
  send(data: Uint8Array, cb?: (err?: Error) => void): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown, isBinary: boolean) => void): void;
  on(event: 'close', listener: () => void): void;
}

interface Conn {
  ws: WSConn;
  role: Role;
  personaId: string;
  clientAwarenessIds: number[];
  lastRoleCheck: number;
}

/** Re-check membership at most this often on mutating Yjs frames. */
const ROLE_RECHECK_MS = 5000;

interface RoomChannel {
  room: Room;
  awareness: awarenessProtocol.Awareness;
  sockets: Map<WSConn, Conn>;
}

export interface YjsServerOptions {
  wsPort?: number;
  server?: http.Server;
  rooms: RoomManager;
  membership: MembershipStore;
}

interface UpgradeContext {
  projectId: string;
  fileId: string;
  personaId: string;
}

function parseUpgradeTarget(req: http.IncomingMessage): UpgradeContext | null {
  const url = new URL(req.url ?? '/', 'ws://localhost');
  const segments = url.pathname.split('/').filter(Boolean);
  // /yjs/:projectId/:fileId?personaId=...
  if (segments[0] !== 'yjs') return null;
  const projectId = segments[1];
  const fileId = segments[2];
  const personaId = url.searchParams.get('personaId');
  if (!projectId || !fileId || !personaId) return null;
  return { projectId, fileId, personaId };
}

function respondAndClose(socket: import('node:stream').Duplex, status: number, code: string): void {
  const body = JSON.stringify({ error: { code } });
  socket.write(
    `HTTP/1.1 ${status} ${code}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(
      body,
    )}\r\n\r\n${body}`,
  );
  socket.end();
}

/**
 * Dedicated Yjs CRUD channel: /yjs/:projectId/:fileId?personaId=...
 * Implements the standard y-websocket binary protocol (y-protocols sync +
 * awareness), enforcing RBAC at the frame level: VIEWER connections may read
 * and share awareness, but every document-mutating frame (sync step 2 /
 * update) is dropped before it ever reaches the Y.Doc.
 */
export function createYjsServer(options: YjsServerOptions): http.Server {
  const isSharedServer = Boolean(options.server);
  const httpServer =
    options.server ??
    http.createServer((_req, res) => {
      res.writeHead(404).end();
    });
  const wss = new WebSocketServer({ noServer: true });
  const channels = new Map<string, RoomChannel>();
  const channelCreations = new Map<string, Promise<RoomChannel>>();
  const channelClosures = new Map<string, Promise<void>>();
  const rooms = options.rooms;

  async function ensureChannel(projectId: string, fileId: string): Promise<RoomChannel> {
    const key = `${projectId}/${fileId}`;

    // Wait for an in-progress teardown first. Otherwise a reconnecting peer
    // can attach to a room whose Y.Doc is about to be destroyed.
    const closing = channelClosures.get(key);
    if (closing) await closing;

    const existing = channels.get(key);
    if (existing) {
      return existing;
    }

    const pending = channelCreations.get(key);
    if (pending) return pending;

    const creation = (async () => {
      const room = await rooms.getRoom(projectId, fileId);
      const channel: RoomChannel = {
        room,
        awareness: room.awareness,
        sockets: new Map(),
      };
      channels.set(key, channel);
      return channel;
    })();

    channelCreations.set(key, creation);
    try {
      return await creation;
    } finally {
      channelCreations.delete(key);
    }
  }

  function closeChannel(key: string, channel: RoomChannel): void {
    if (channel.sockets.size > 0 || channelClosures.has(key)) return;
    channels.delete(key);

    const closure = rooms
      .destroyRoomInstance(channel.room)
      .catch((error: unknown) => {
        console.error('[yjs] room teardown failed:', error);
      })
      .finally(() => {
        if (channelClosures.get(key) === closure) {
          channelClosures.delete(key);
        }
      });
    channelClosures.set(key, closure);
  }

  function broadcastDocUpdate(channel: RoomChannel, update: Uint8Array, exclude?: WSConn): void {
    for (const [ws] of channel.sockets) {
      if (ws === exclude) continue;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      queueMicrotask(() =>
        sendSafe(ws, encoding.toUint8Array(encoder)),
      );
    }
  }

  function broadcastAwareness(
    channel: RoomChannel,
    sender: Conn | null,
    changedIds: number[],
  ): void {
    if (changedIds.length === 0) return;
    const update = awarenessProtocol.encodeAwarenessUpdate(channel.awareness, changedIds);
    for (const [ws, conn] of channel.sockets) {
      if (conn === sender) continue;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, update);
      queueMicrotask(() => sendSafe(ws, encoding.toUint8Array(encoder)));
    }
  }

  function sendSafe(ws: WSConn, data: Uint8Array): void {
    try {
      ws.send(data);
    } catch {
      // peer died mid-flush; its close handler cleans up
    }
  }

  httpServer.on('upgrade', (req, socket, head) => {
    const target = parseUpgradeTarget(req);
    if (!target) {
      if (isSharedServer) {
        // Let other handlers on the shared HTTP server (e.g. Socket.IO) handle this upgrade
        return;
      }
      respondAndClose(socket, 400, 'bad_request');
      return;
    }
    const persona = resolvePersona(target.personaId);
    if (!persona) {
      respondAndClose(socket, 401, 'unauthorized');
      return;
    }
    void (async () => {
      try {
        const role = await options.membership.get(target.projectId, persona.id);
        if (!role) {
          respondAndClose(socket, 403, 'forbidden');
          return;
        }
        const channel = await ensureChannel(target.projectId, target.fileId);
        wss.handleUpgrade(req, socket, head, (ws) => {
          void attach(ws as unknown as WSConn, channel, role, persona.id);
        });
      } catch (error: unknown) {
        console.error('[yjs] connection setup failed:', error);
        respondAndClose(socket, 500, 'internal_error');
      }
    })();
  });

  async function attach(ws: WSConn, channel: RoomChannel, role: Role, personaId: string): Promise<void> {
    const conn: Conn = {
      ws,
      role,
      personaId,
      clientAwarenessIds: [],
      lastRoleCheck: Date.now(),
    };
    channel.sockets.set(ws, conn);
    channel.room.trackConnection(conn);

    // Standard y-websocket handshake: ask client for its state diff, share awareness.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, channel.room.ydoc);
    sendSafe(ws, encoding.toUint8Array(syncEncoder));

    const awarenessStates = channel.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      const update = awarenessProtocol.encodeAwarenessUpdate(
        channel.awareness,
        Array.from(awarenessStates.keys()),
      );
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(awarenessEncoder, update);
      sendSafe(ws, encoding.toUint8Array(awarenessEncoder));
    }

    const docUpdateHandler = (update: Uint8Array, origin: unknown): void => {
      if (origin === 'load') return;
      broadcastDocUpdate(channel, update, undefined);
    };
    channel.room.ydoc.on('update', docUpdateHandler);

    const awarenessHandler = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ): void => {
      broadcastAwareness(channel, origin === conn ? conn : null, [
        ...changes.added,
        ...changes.updated,
        ...changes.removed,
      ]);
    };
    channel.awareness.on('update', awarenessHandler);

    ws.on('message', (data: unknown, isBinary: boolean) => {
      if (!isBinary) return;
      void handleIncomingMessage(channel, conn, new Uint8Array(data as Buffer)).catch(
        (error: unknown) => {
          console.error('[yjs] message handling failed for', conn.personaId, error);
        },
      );
    });

    ws.on('close', () => {
      channel.room.ydoc.off('update', docUpdateHandler);
      channel.awareness.off('update', awarenessHandler);
      if (conn.clientAwarenessIds.length > 0) {
        awarenessProtocol.removeAwarenessStates(channel.awareness, conn.clientAwarenessIds, null);
      }
      channel.sockets.delete(ws);
      channel.room.releaseConnection(conn);
      closeChannel(`${channel.room.projectId}/${channel.room.fileId}`, channel);
    });
  }

  async function handleIncomingMessage(
    channel: RoomChannel,
    conn: Conn,
    data: Uint8Array,
  ): Promise<void> {
    const classification = classifyIncomingMessage(data);
    if (classification.kind === 'invalid') return;

    // The handshake role can go stale during a long-lived session. Re-check
    // membership periodically and fail closed if the member was removed or
    // demoted. This is also the write gate for y-websocket frames.
    if (Date.now() - conn.lastRoleCheck >= ROLE_RECHECK_MS) {
      try {
        const role = await options.membership.get(channel.room.projectId, conn.personaId);
        conn.lastRoleCheck = Date.now();
        if (!role) {
          conn.ws.close(4403, 'forbidden');
          return;
        }
        conn.role = role;
      } catch (error: unknown) {
        console.error('[yjs] membership re-check failed for', conn.personaId, error);
        return;
      }
    }

    if (classification.kind === 'sync' && classification.mutating && !canPersonaWrite(conn.role)) {
      console.warn(
        `[yjs] dropped mutating frame from ${conn.personaId} (role ${conn.role}) on file ${channel.room.fileId}`,
      );
      return;
    }

    const decoder = decoding.createDecoder(data);
    let messageType: number;
    try {
      messageType = decoding.readVarUint(decoder);
    } catch {
      return;
    }

    if (messageType === MESSAGE_SYNC) {
      try {
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, replyEncoder, channel.room.ydoc, conn);
        if (encoding.length(replyEncoder) > 1) {
          sendSafe(conn.ws, encoding.toUint8Array(replyEncoder));
        }
      } catch (error: unknown) {
        console.warn('[yjs] invalid sync frame from', conn.personaId, error);
      }
      return;
    }

    if (messageType !== MESSAGE_AWARENESS) return;

    // Awareness: relaying presence is allowed for every role.
    try {
      const update = decoding.readVarUint8Array(decoder);
      const decoderAwareness = decoding.createDecoder(update);
      const len = decoding.readVarUint(decoderAwareness);
      for (let i = 0; i < len; i++) {
        const clientID = decoding.readVarUint(decoderAwareness);
        decoding.readVarUint(decoderAwareness);
        decoding.readVarString(decoderAwareness);
        if (!conn.clientAwarenessIds.includes(clientID)) {
          conn.clientAwarenessIds.push(clientID);
        }
      }
      awarenessProtocol.applyAwarenessUpdate(channel.awareness, update, conn);
    } catch (error: unknown) {
      console.warn('[yjs] invalid awareness frame from', conn.personaId, error);
    }
  }

  return httpServer;
}
