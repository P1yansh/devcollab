import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { io as ioClient, type Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import WebSocket from 'ws';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@devcollab/shared';

import { createControlChannel } from './socket/control-channel.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { createYjsServer } from './yjs/yjs-server.js';
import { RoomManager } from './yjs/room-manager.js';
import type { AllStores, FileRecord, MemberRecord, ProjectRecord, SnapshotRecord } from './store/types.js';

class NodeWebSocket extends WebSocket {
  constructor(address: string | URL, protocols?: any, options?: any) {
    super(address, protocols, options);
    this.binaryType = 'arraybuffer';
  }
}
// @ts-expect-error polyfill
global.WebSocket = NodeWebSocket;

const TEST_PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const TEST_FILE_ID = '22222222-2222-4222-8222-222222222222';

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function createMockStores(): AllStores {
  const projects = new Map<string, ProjectRecord>();
  const members = new Map<string, Map<string, MemberRecord>>();
  const files = new Map<string, Map<string, FileRecord>>();
  const snapshots = new Map<string, SnapshotRecord[]>();

  const demoProj: ProjectRecord = {
    id: TEST_PROJECT_ID,
    name: 'Test Project',
    description: 'E2E Test',
    inviteCode: 'test-invite',
  };
  projects.set(demoProj.id, demoProj);

  const projMembers = new Map<string, MemberRecord>();
  projMembers.set('persona-alice', {
    userId: 'persona-alice',
    username: 'Alice',
    avatarColor: '#6366f1',
    role: 'OWNER',
    joinedAt: new Date(),
  });
  projMembers.set('persona-bob', {
    userId: 'persona-bob',
    username: 'Bob',
    avatarColor: '#10b981',
    role: 'EDITOR',
    joinedAt: new Date(),
  });
  projMembers.set('persona-charlie', {
    userId: 'persona-charlie',
    username: 'Charlie',
    avatarColor: '#f59e0b',
    role: 'VIEWER',
    joinedAt: new Date(),
  });
  members.set(demoProj.id, projMembers);

  const projFiles = new Map<string, FileRecord>();
  const mainFile: FileRecord = {
    id: TEST_FILE_ID,
    projectId: demoProj.id,
    path: 'index.ts',
    language: 'TYPESCRIPT',
    updatedAt: new Date(),
  };
  projFiles.set(mainFile.id, mainFile);
  files.set(demoProj.id, projFiles);

  return {
    projects: {
      async create(input) {
        const id = 'proj-' + Math.random();
        const rec = { id, name: input.name, description: input.description || null, inviteCode: 'code' };
        projects.set(id, rec);
        return rec;
      },
      async listFor() {
        return Array.from(projects.values()).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          role: 'OWNER' as const,
          memberCount: 1,
          fileCount: 1,
        }));
      },
      async get(id) {
        return projects.get(id) || null;
      },
      async findByInviteCode(code) {
        return Array.from(projects.values()).find((p) => p.inviteCode === code) || null;
      },
      async addMember(projectId, userId, role) {
        let m = members.get(projectId);
        if (!m) {
          m = new Map();
          members.set(projectId, m);
        }
        const rec = { userId, username: userId, avatarColor: '#fff', role, joinedAt: new Date() };
        m.set(userId, rec);
        return rec;
      },
      async setRole(projectId, userId, role) {
        const m = members.get(projectId)?.get(userId);
        if (m) m.role = role;
        return m!;
      },
    },
    membership: {
      async get(projectId, userId) {
        return members.get(projectId)?.get(userId)?.role || null;
      },
      async list(projectId) {
        return Array.from(members.get(projectId)?.values() || []);
      },
    },
    files: {
      async create(input) {
        const id = 'file-' + Math.random();
        const rec: FileRecord = {
          id,
          projectId: input.projectId,
          path: input.path,
          language: input.language,
          updatedAt: new Date(),
        };
        let m = files.get(input.projectId);
        if (!m) {
          m = new Map();
          files.set(input.projectId, m);
        }
        m.set(id, rec);
        return rec;
      },
      async rename(projectId, fileId, path) {
        const f = files.get(projectId)?.get(fileId);
        if (f) f.path = path;
        return f || null;
      },
      async delete(projectId, fileId) {
        const f = files.get(projectId)?.get(fileId);
        if (f) files.get(projectId)?.delete(fileId);
        return f || null;
      },
      async list(projectId) {
        return Array.from(files.get(projectId)?.values() || []);
      },
      async get(projectId, fileId) {
        return files.get(projectId)?.get(fileId) || null;
      },
    },
    snapshots: {
      async create(input) {
        const id = 'snap-' + Math.random();
        const rec: SnapshotRecord = {
          id,
          projectId: input.projectId,
          fileId: input.fileId,
          filePath: 'index.ts',
          createdById: input.createdById,
          createdByName: 'Alice',
          label: input.label,
          createdAt: new Date(),
          sizeBytes: input.yjsBinary.length,
          yjsBinary: input.yjsBinary,
          readableText: input.readableText,
        };
        const list = snapshots.get(input.projectId) || [];
        list.unshift(rec);
        snapshots.set(input.projectId, list);
        return rec;
      },
      async list(projectId, fileId) {
        return snapshots.get(projectId)?.filter((s) => s.fileId === fileId) || [];
      },
      async get(projectId, snapshotId) {
        return snapshots.get(projectId)?.find((s) => s.id === snapshotId) || null;
      },
    },
  };
}

describe('DevCollab Full Multiplayer Integration', () => {
  let httpServer: http.Server;
  let yjsServer: http.Server;
  let stores: AllStores;
  let roomManager: RoomManager;

  const HTTP_PORT = 4130;
  const YJS_PORT = 4131;

  beforeAll(async () => {
    stores = createMockStores();

    const listeners = new Set<(p: string, f: string, u: Uint8Array) => void>();
    const mockPublishChannel = {
      publish(p: string, f: string, u: Uint8Array) {
        listeners.forEach((l) => l(p, f, u));
      },
      subscribe(fn: (p: string, f: string, u: Uint8Array) => void) {
        listeners.add(fn);
      },
    };

    const persistedDocs = new Map<string, Buffer>();
    const docStateStore = {
      async load(fileId: string) {
        return { projectId: TEST_PROJECT_ID, state: persistedDocs.get(fileId) ?? null };
      },
      async save(fileId: string, state: Buffer) {
        persistedDocs.set(fileId, Buffer.from(state));
      },
    };

    roomManager = new RoomManager(docStateStore, mockPublishChannel);

    const app = express();
    httpServer = http.createServer(app);
    const io = createControlChannel(httpServer);
    registerSocketHandlers(io, stores, roomManager);

    yjsServer = createYjsServer({
      wsPort: YJS_PORT,
      rooms: roomManager,
      membership: stores.membership,
    });

    await new Promise<void>((r) => httpServer.listen(HTTP_PORT, () => r()));
    await new Promise<void>((r) => yjsServer.listen(YJS_PORT, () => r()));
  });

  afterAll(async () => {
    httpServer.close();
    yjsServer.close();
  });

  it('delivers real-time chat messages across project collaborators', async () => {
    const socketAlice: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(
      `http://localhost:${HTTP_PORT}`,
      { auth: { personaId: 'persona-alice' } },
    );
    const socketBob: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(
      `http://localhost:${HTTP_PORT}`,
      { auth: { personaId: 'persona-bob' } },
    );

    await new Promise((r) => setTimeout(r, 100));

    // Both join project room
    await new Promise<void>((resolve) => {
      socketAlice.emit('project:join', { projectId: TEST_PROJECT_ID }, () => resolve());
    });
    await new Promise<void>((resolve) => {
      socketBob.emit('project:join', { projectId: TEST_PROJECT_ID }, () => resolve());
    });

    // Bob listens for chat message
    const chatPromise = new Promise<{ content: string; username: string }>((resolve) => {
      socketBob.on('chat:message', (msg) => resolve(msg));
    });

    // Alice sends chat
    socketAlice.emit('chat:send', {
      projectId: TEST_PROJECT_ID,
      content: 'Hey Bob, check out line 10!',
    });

    const received = await chatPromise;
    expect(received.content).toBe('Hey Bob, check out line 10!');
    expect(received.username).toBe('Alice');

    socketAlice.disconnect();
    socketBob.disconnect();
  });

  it('rejects execution requests from Charlie (VIEWER role)', async () => {
    const socketCharlie: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(
      `http://localhost:${HTTP_PORT}`,
      { auth: { personaId: 'persona-charlie' } },
    );

    await new Promise((r) => setTimeout(r, 100));

    await new Promise<void>((resolve) => {
      socketCharlie.emit('project:join', { projectId: TEST_PROJECT_ID }, () => resolve());
    });

    const rejectPromise = new Promise<{ reason: string; message: string }>((resolve) => {
      socketCharlie.on('execution:rejected', (event) => resolve(event));
    });

    socketCharlie.emit('execution:run', {
      projectId: TEST_PROJECT_ID,
      fileId: TEST_FILE_ID,
    });

    const rejection = await rejectPromise;
    expect(rejection.reason).toBe('forbidden');
    expect(rejection.message).toContain('viewers cannot execute code');

    socketCharlie.disconnect();
  });

  it('synchronizes CRDT edits and rejects VIEWER document mutations', async () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const docC = new Y.Doc();
    const room = `yjs/${TEST_PROJECT_ID}/${TEST_FILE_ID}`;
    // Disable BroadcastChannel: otherwise same-process providers would sync
    // directly and mask the server-side viewer write rejection.
    const common = { WebSocketPolyfill: NodeWebSocket as any, disableBc: true };

    const providerA = new WebsocketProvider(`ws://localhost:${YJS_PORT}`, room, docA, {
      ...common,
      params: { personaId: 'persona-alice' },
    });
    const providerB = new WebsocketProvider(`ws://localhost:${YJS_PORT}`, room, docB, {
      ...common,
      params: { personaId: 'persona-bob' },
    });
    const providerC = new WebsocketProvider(`ws://localhost:${YJS_PORT}`, room, docC, {
      ...common,
      params: { personaId: 'persona-charlie' },
    });

    try {
      await waitFor(() => providerA.synced && providerB.synced && providerC.synced);

      const aliceEdit = 'const fromAlice = true;\n';
      docA.getText('monaco').insert(0, aliceEdit);
      await waitFor(() => docB.getText('monaco').toString().includes(aliceEdit));

      const beforeViewerWrite = docB.getText('monaco').toString();
      docC.getText('monaco').insert(0, 'viewer write must not sync\n');
      await sleep(400);

      expect(await roomManager.getText(TEST_PROJECT_ID, TEST_FILE_ID)).toBe(beforeViewerWrite);
      expect(docB.getText('monaco').toString()).toBe(beforeViewerWrite);
    } finally {
      providerA.destroy();
      providerB.destroy();
      providerC.destroy();
      docA.destroy();
      docB.destroy();
      docC.destroy();
    }
  }, 15000);

  it('broadcasts execution stdout and exit events when Bob (EDITOR) runs code', async () => {
    // Populate code in the live Y.Doc
    await roomManager.applyRollback(
      TEST_PROJECT_ID,
      TEST_FILE_ID,
      'console.log("Live Execution Streamed!");',
    );

    const socketAlice: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(
      `http://localhost:${HTTP_PORT}`,
      { auth: { personaId: 'persona-alice' } },
    );
    const socketBob: Socket<ServerToClientEvents, ClientToServerEvents> = ioClient(
      `http://localhost:${HTTP_PORT}`,
      { auth: { personaId: 'persona-bob' } },
    );

    await new Promise((r) => setTimeout(r, 100));

    await new Promise<void>((resolve) => {
      socketAlice.emit('project:join', { projectId: TEST_PROJECT_ID }, () => resolve());
    });
    await new Promise<void>((resolve) => {
      socketBob.emit('project:join', { projectId: TEST_PROJECT_ID }, () => resolve());
    });

    let stdoutReceived = '';
    const exitPromise = new Promise<number>((resolve) => {
      socketAlice.on('execution:stdout', (ev) => {
        stdoutReceived += ev.chunk;
      });
      socketAlice.on('execution:exit', (ev) => {
        resolve(ev.exitCode);
      });
    });

    // Bob runs code
    socketBob.emit('execution:run', {
      projectId: TEST_PROJECT_ID,
      fileId: TEST_FILE_ID,
    });

    const exitCode = await exitPromise;
    expect(exitCode).toBe(0);
    expect(stdoutReceived).toContain('Live Execution Streamed!');

    socketAlice.disconnect();
    socketBob.disconnect();
  }, 15000);
});
