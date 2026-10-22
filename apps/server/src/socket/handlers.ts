import crypto from 'node:crypto';
import type { Socket } from 'socket.io';
import {
  type ClientToServerEvents,
  type ServerToClientEvents,
  type Role,
  type PeerPresence,
  type DemoPersona,
  type FileNode,
  type MemberSummary,
  type SnapshotMeta,
  type Permission,
  DEMO_PERSONAS,
  hasPermission,
  chatSendSchema,
  createFileSchema,
  createSnapshotSchema,
  deleteFileSchema,
  executionRunSchema,
  joinRoomSchema,
  presenceUpdateSchema,
  renameFileSchema,
  rollbackProjectSchema,
} from '@devcollab/shared';
import type { ControlChannel } from './control-channel.js';
import type {
  FileRecord,
  FileStore,
  MemberRecord,
  MembershipStore,
  ProjectStore,
  SnapshotRecord,
  SnapshotStore,
} from '../store/types.js';
import type { RoomManager } from '../yjs/room-manager.js';
import { executeCode } from '../execution/runner.js';
import { env } from '../config/env.js';

export interface HandlerStores {
  projects: ProjectStore;
  membership: MembershipStore;
  files: FileStore;
  snapshots: SnapshotStore;
}

interface PresenceState {
  clientId: number;
  persona: DemoPersona;
  role: Role;
  fileId: string | null;
  line: number | null;
  column: number | null;
}

function toFileNode(file: FileRecord): FileNode {
  return {
    id: file.id,
    projectId: file.projectId,
    path: file.path,
    language: file.language,
    updatedAt: file.updatedAt.toISOString(),
  };
}

function toMemberSummary(member: MemberRecord): MemberSummary {
  return {
    userId: member.userId,
    username: member.username,
    avatarColor: member.avatarColor,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}

// In-memory active presence map per project: projectId -> Map<socketId, PresenceState>
const projectPresence = new Map<string, Map<string, PresenceState>>();

function getOrCreateProjectPresence(projectId: string): Map<string, PresenceState> {
  let map = projectPresence.get(projectId);
  if (!map) {
    map = new Map();
    projectPresence.set(projectId, map);
  }
  return map;
}

function getPresenceRoster(projectId: string): PeerPresence[] {
  const map = projectPresence.get(projectId);
  if (!map) return [];
  return Array.from(map.values()).map((p) => ({
    clientId: p.clientId,
    userId: p.persona.id,
    username: p.persona.username,
    avatarColor: p.persona.avatarColor,
    role: p.role,
    fileId: p.fileId,
    line: p.line,
    column: p.column,
  }));
}

export function registerSocketHandlers(
  io: ControlChannel,
  stores: HandlerStores,
  roomManager: RoomManager,
): void {
  io.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as unknown as Socket<ClientToServerEvents, ServerToClientEvents>;
    const persona = rawSocket.data.persona as DemoPersona;
    if (!persona) {
      socket.disconnect(true);
      return;
    }

    const clientId = Math.floor(Math.random() * 1_000_000) + 1;
    let currentProjectId: string | null = null;
    let currentRole: Role = 'VIEWER';

    function assertProjectScope(
      targetProjectId: string,
    ): { ok: true } | { ok: false; error: string } {
      if (!currentProjectId || currentProjectId !== targetProjectId) {
        return { ok: false, error: 'Forbidden: You have not joined this project' };
      }
      return { ok: true };
    }

    /**
     * Refresh membership from the database before a privileged action. The
     * role cached at join time can go stale if an owner changes it while this
     * socket remains connected.
     */
    async function assertPermission(
      targetProjectId: string,
      permission: Permission,
    ): Promise<{ ok: true } | { ok: false; error: string }> {
      const scope = assertProjectScope(targetProjectId);
      if (!scope.ok) return scope;

      let role: Role | null;
      try {
        role = await stores.membership.get(targetProjectId, persona.id);
      } catch {
        return { ok: false, error: 'Forbidden: Membership check failed' };
      }

      if (!role) {
        currentProjectId = null;
        currentRole = 'VIEWER';
        return { ok: false, error: 'Forbidden: You are no longer a member of this project' };
      }

      currentRole = role;
      if (!hasPermission(role, permission)) {
        return { ok: false, error: `Forbidden: Missing required permission ${permission}` };
      }
      return { ok: true };
    }

    // ---------------------------------------------------------------- Project Join
    socket.on('project:join', async (payload, ack) => {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'Invalid join parameters' });
        return;
      }

      const { projectId } = parsed.data;

      const role = await stores.membership.get(projectId, persona.id);
      if (!role) {
        ack({ ok: false, error: 'Unauthorized: Not a member of this project' });
        return;
      }

      currentProjectId = projectId;
      currentRole = role;

      rawSocket.join(`project:${projectId}`);

      const [files, members, project] = await Promise.all([
        stores.files.list(projectId),
        stores.membership.list(projectId),
        stores.projects.get(projectId),
      ]);

      const snapshotLists = await Promise.all(
        files.map((f) => stores.snapshots.list(projectId, f.id)),
      );

      const snapshots: SnapshotMeta[] = snapshotLists.flat().map((s) => ({
        id: s.id,
        fileId: s.fileId,
        filePath: s.filePath,
        label: s.label,
        createdById: s.createdById,
        createdByName: s.createdByName,
        createdAt: s.createdAt.toISOString(),
        sizeBytes: s.sizeBytes,
      }));

      const presenceMap = getOrCreateProjectPresence(projectId);
      const state: PresenceState = {
        clientId,
        persona,
        role,
        fileId: null,
        line: null,
        column: null,
      };
      presenceMap.set(rawSocket.id, state);

      const peerPresence: PeerPresence = {
        clientId,
        userId: persona.id,
        username: persona.username,
        avatarColor: persona.avatarColor,
        role,
        fileId: state.fileId,
        line: state.line,
        column: state.column,
      };

      // Notify other peers in room
      rawSocket.to(`project:${projectId}`).emit('peer:joined', { peer: peerPresence });

      // Return initial snapshot to joining client
      ack({
        ok: true,
        data: {
          role,
          inviteCode: role === 'VIEWER' ? undefined : project?.inviteCode,
          files: files.map(toFileNode),
          members: members.map(toMemberSummary),
          snapshots,
        },
      });

      // Broadcast complete presence roster
      io.to(`project:${projectId}`).emit('presence:sync', { peers: getPresenceRoster(projectId) });
    });

    // ---------------------------------------------------------------- Project Leave
    socket.on('project:leave', (payload) => {
      if (currentProjectId === payload.projectId) {
        rawSocket.leave(`project:${payload.projectId}`);
        const map = projectPresence.get(payload.projectId);
        if (map) {
          map.delete(rawSocket.id);
          io.to(`project:${payload.projectId}`).emit('peer:left', { clientId });
          io.to(`project:${payload.projectId}`).emit('presence:sync', {
            peers: getPresenceRoster(payload.projectId),
          });
        }
        currentProjectId = null;
        currentRole = 'VIEWER';
      }
    });

    // ---------------------------------------------------------------- Presence Update
    socket.on('presence:update', (payload) => {
      const parsed = presenceUpdateSchema.safeParse(payload);
      if (!parsed.success) return;

      const scope = assertProjectScope(parsed.data.projectId);
      if (!scope.ok) return;

      const map = projectPresence.get(parsed.data.projectId);
      if (map) {
        const state = map.get(rawSocket.id);
        if (state) {
          state.fileId = parsed.data.fileId;
          state.line = parsed.data.line;
          state.column = parsed.data.column;

          const updatedPeer: PeerPresence = {
            clientId,
            userId: persona.id,
            username: persona.username,
            avatarColor: persona.avatarColor,
            role: currentRole,
            fileId: state.fileId,
            line: state.line,
            column: state.column,
          };
          rawSocket.to(`project:${parsed.data.projectId}`).emit('presence:update', { peer: updatedPeer });
        }
      }
    });

    // ---------------------------------------------------------------- Chat Message
    socket.on('chat:send', async (payload) => {
      const parsed = chatSendSchema.safeParse(payload);
      if (!parsed.success) return;

      const scope = await assertPermission(parsed.data.projectId, 'chat:send');
      if (!scope.ok) return;

      const msg = {
        id: crypto.randomUUID(),
        projectId: parsed.data.projectId,
        userId: persona.id,
        username: persona.username,
        avatarColor: persona.avatarColor,
        content: parsed.data.content,
        createdAt: new Date().toISOString(),
      };

      io.to(`project:${parsed.data.projectId}`).emit('chat:message', msg);
    });

    // ---------------------------------------------------------------- File Create
    socket.on('file:create', async (payload, ack) => {
      const parsed = createFileSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid parameters' });
        return;
      }
      const scope = await assertPermission(parsed.data.projectId, 'file:create');
      if (!scope.ok) {
        ack({ ok: false, error: scope.error });
        return;
      }

      try {
        const record = await stores.files.create({
          projectId: parsed.data.projectId,
          path: parsed.data.path,
          language: parsed.data.language,
          content: parsed.data.content,
        });
        const file = toFileNode(record);
        io.to(`project:${parsed.data.projectId}`).emit('file:created', { file });
        ack({ ok: true, data: file });
      } catch (err: any) {
        ack({ ok: false, error: err?.message || 'Failed to create file' });
      }
    });

    // ---------------------------------------------------------------- File Rename
    socket.on('file:rename', async (payload, ack) => {
      const parsed = renameFileSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid parameters' });
        return;
      }
      const scope = await assertPermission(parsed.data.projectId, 'file:update');
      if (!scope.ok) {
        ack({ ok: false, error: scope.error });
        return;
      }

      try {
        const record = await stores.files.rename(
          parsed.data.projectId,
          parsed.data.fileId,
          parsed.data.path,
        );
        if (!record) {
          ack({ ok: false, error: 'File not found' });
          return;
        }
        const file = toFileNode(record);
        io.to(`project:${parsed.data.projectId}`).emit('file:renamed', { file });
        ack({ ok: true, data: file });
      } catch (err: any) {
        ack({ ok: false, error: err?.message || 'Failed to rename file' });
      }
    });

    // ---------------------------------------------------------------- File Delete
    socket.on('file:delete', async (payload, ack) => {
      const parsed = deleteFileSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid parameters' });
        return;
      }
      const scope = await assertPermission(parsed.data.projectId, 'file:delete');
      if (!scope.ok) {
        ack({ ok: false, error: scope.error });
        return;
      }

      try {
        const record = await stores.files.delete(parsed.data.projectId, parsed.data.fileId);
        if (!record) {
          ack({ ok: false, error: 'File not found' });
          return;
        }
        await roomManager.destroyRoom(parsed.data.projectId, parsed.data.fileId);
        const file = toFileNode(record);
        io.to(`project:${parsed.data.projectId}`).emit('file:deleted', { file });
        ack({ ok: true, data: undefined });
      } catch (err: any) {
        ack({ ok: false, error: err?.message || 'Failed to delete file' });
      }
    });

    // ---------------------------------------------------------------- Sandboxed Code Execution
    socket.on('execution:run', async (payload) => {
      const parsed = executionRunSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('execution:rejected', {
          executionId: null,
          reason: 'unsupported-language',
          message: 'Invalid execution parameters',
        });
        return;
      }

      const scope = await assertPermission(parsed.data.projectId, 'code:execute');
      if (!scope.ok) {
        socket.emit('execution:rejected', {
          executionId: null,
          reason: 'forbidden',
          message:
            currentRole === 'VIEWER'
              ? 'Read-only viewers cannot execute code.'
              : scope.error,
        });
        return;
      }

      let file: Awaited<ReturnType<FileStore['get']>>;
      let liveCode: string;
      try {
        file = await stores.files.get(parsed.data.projectId, parsed.data.fileId);
        if (!file) {
          socket.emit('execution:rejected', {
            executionId: null,
            reason: 'internal',
            message: 'File not found.',
          });
          return;
        }

        if (file.language === 'MARKDOWN') {
          socket.emit('execution:rejected', {
            executionId: null,
            reason: 'unsupported-language',
            message: 'Cannot execute Markdown files.',
          });
          return;
        }

        // CRDT Single Source of Truth: execution runs against live in-memory Y.Doc text
        liveCode = await roomManager.getText(parsed.data.projectId, parsed.data.fileId);
      } catch (error: unknown) {
        socket.emit('execution:rejected', {
          executionId: null,
          reason: 'internal',
          message:
            error instanceof Error
              ? `Unable to load file: ${error.message}`
              : 'Unable to load file for execution.',
        });
        return;
      }

      const executionId = crypto.randomUUID();

      const configuredBackend = env.EXECUTION_BACKEND;
      io.to(`project:${parsed.data.projectId}`).emit('execution:started', {
        executionId,
        language: file.language,
        backend: configuredBackend === 'auto' ? 'auto' : configuredBackend,
        startedBy: {
          userId: persona.id,
          username: persona.username,
          avatarColor: persona.avatarColor,
        },
      });

      try {
        const res = await executeCode({
          code: liveCode,
          language: file.language,
          onStdout: (chunk) => {
            io.to(`project:${parsed.data.projectId}`).emit('execution:stdout', {
              executionId,
              chunk,
            });
          },
          onStderr: (chunk) => {
            io.to(`project:${parsed.data.projectId}`).emit('execution:stderr', {
              executionId,
              chunk,
            });
          },
        });

        io.to(`project:${parsed.data.projectId}`).emit('execution:exit', {
          executionId,
          // The backend that ACTUALLY ran the code (fixed in dispatch), which
          // may differ from the configured one when a fallback chain engaged.
          backend: res.backend,
          exitCode: res.exitCode,
          durationMs: res.durationMs,
          timedOut: res.timedOut,
        });
      } catch (err: any) {
        const isBusy = err?.code === 'BUSY' || err?.message?.toLowerCase().includes('busy');
        io.to(`project:${parsed.data.projectId}`).emit('execution:rejected', {
          executionId,
          reason: isBusy ? 'busy' : 'internal',
          message: err?.message || 'Execution error in container sandbox',
        });
      }
    });

    // ---------------------------------------------------------------- Snapshots & Rollback
    socket.on('snapshot:create', async (payload, ack) => {
      const parsed = createSnapshotSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid parameters' });
        return;
      }

      const scope = await assertPermission(parsed.data.projectId, 'snapshot:create');
      if (!scope.ok) {
        ack({ ok: false, error: scope.error });
        return;
      }

      try {
        const [yjsBinary, readableText] = await Promise.all([
          roomManager.getBinaryState(parsed.data.projectId, parsed.data.fileId),
          roomManager.getText(parsed.data.projectId, parsed.data.fileId),
        ]);

        const snapshot: SnapshotRecord = await stores.snapshots.create({
          projectId: parsed.data.projectId,
          fileId: parsed.data.fileId,
          createdById: persona.id,
          label: parsed.data.label,
          yjsBinary: Buffer.from(yjsBinary),
          readableText,
        });

        const meta: SnapshotMeta = {
          id: snapshot.id,
          fileId: snapshot.fileId,
          filePath: snapshot.filePath,
          label: snapshot.label,
          createdById: snapshot.createdById,
          createdByName: snapshot.createdByName,
          createdAt: snapshot.createdAt.toISOString(),
          sizeBytes: snapshot.sizeBytes,
        };

        io.to(`project:${parsed.data.projectId}`).emit('snapshot:created', { snapshot: meta });
        ack({ ok: true, data: meta });
      } catch (err: any) {
        ack({ ok: false, error: err?.message || 'Failed to create snapshot' });
      }
    });

    socket.on('snapshot:rollback', async (payload, ack) => {
      const parsed = rollbackProjectSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: parsed.error.issues[0]?.message || 'Invalid parameters' });
        return;
      }

      const scope = await assertPermission(parsed.data.projectId, 'snapshot:rollback');
      if (!scope.ok) {
        ack({ ok: false, error: scope.error });
        return;
      }

      try {
        const snapshot = await stores.snapshots.get(parsed.data.projectId, parsed.data.snapshotId);
        if (!snapshot) {
          ack({ ok: false, error: 'Snapshot not found' });
          return;
        }

        // Invariant: Non-destructive rollback applied via Y.Doc transaction
        await roomManager.applyRollback(
          parsed.data.projectId,
          snapshot.fileId,
          snapshot.readableText,
        );

        io.to(`project:${parsed.data.projectId}`).emit('snapshot:rollbackApplied', {
          snapshotId: parsed.data.snapshotId,
          filePath: snapshot.filePath,
          restoredBy: persona.username,
        });

        ack({
          ok: true,
          data: {
            snapshotId: parsed.data.snapshotId,
            filePath: snapshot.filePath,
          },
        });
      } catch (err: any) {
        ack({ ok: false, error: err?.message || 'Rollback failed' });
      }
    });

    // ---------------------------------------------------------------- Disconnect
    rawSocket.on('disconnect', () => {
      if (currentProjectId) {
        const map = projectPresence.get(currentProjectId);
        if (map) {
          map.delete(rawSocket.id);
          io.to(`project:${currentProjectId}`).emit('peer:left', { clientId });
          io.to(`project:${currentProjectId}`).emit('presence:sync', {
            peers: getPresenceRoster(currentProjectId),
          });
        }
        currentProjectId = null;
        currentRole = 'VIEWER';
      }
    });
  });
}
