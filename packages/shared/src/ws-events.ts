import type { z } from 'zod';
import type {
  ExecutionExitEvent,
  ExecutionOutputEvent,
  ExecutionRejectedEvent,
  ExecutionStartedEvent,
  FileNode,
  MemberSummary,
  PeerPresence,
  ProjectSummary,
  Role,
  SnapshotMeta,
} from './models.js';
import type {
  chatSendSchema,
  createFileSchema,
  createSnapshotSchema,
  deleteFileSchema,
  executionRunSchema,
  joinRoomSchema,
  presenceUpdateSchema,
  renameFileSchema,
} from './schemas.js';

// Shared ack envelope for every event executed via Socket.IO acknowledgements.
export type Ack<T = void> = { ok: true; data: T } | { ok: false; error: string };

// Narrow inferred payload types (keeps event maps self-documenting).
type JoinRoomPayload = z.infer<typeof joinRoomSchema>;
type PresenceUpdatePayload = z.infer<typeof presenceUpdateSchema>;
type ChatSendPayload = z.infer<typeof chatSendSchema>;
type CreateFilePayload = z.infer<typeof createFileSchema>;
type RenameFilePayload = z.infer<typeof renameFileSchema>;
type DeleteFilePayload = z.infer<typeof deleteFileSchema>;
type CreateSnapshotPayload = z.infer<typeof createSnapshotSchema>;
type ExecutionRunPayload = z.infer<typeof executionRunSchema>;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export interface ClientToServerEvents {
  'project:join': (
    payload: JoinRoomPayload,
    ack: (
      result: Ack<{
        role: Role;
        inviteCode?: string;
        files: FileNode[];
        members: MemberSummary[];
        snapshots: SnapshotMeta[];
      }>,
    ) => void,
  ) => void;

  'project:leave': (payload: { projectId: string }) => void;

  'presence:update': (payload: PresenceUpdatePayload) => void;

  'chat:send': (payload: ChatSendPayload) => void;

  'file:create': (payload: CreateFilePayload, ack: (result: Ack<FileNode>) => void) => void;
  'file:rename': (payload: RenameFilePayload, ack: (result: Ack<FileNode>) => void) => void;
  'file:delete': (payload: DeleteFilePayload, ack: (result: Ack) => void) => void;

  'execution:run': (payload: ExecutionRunPayload) => void;

  'snapshot:create': (payload: CreateSnapshotPayload, ack: (result: Ack<SnapshotMeta>) => void) => void;
  'snapshot:rollback': (
    payload: { projectId: string; snapshotId: string },
    ack: (result: Ack<{ snapshotId: string; filePath: string }>) => void,
  ) => void;
}

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  'project:joined': (payload: { projectId: string; roster: PeerPresence[] }) => void;
  'peer:joined': (payload: { peer: PeerPresence }) => void;
  'peer:left': (payload: { clientId: number }) => void;
  'presence:sync': (payload: { peers: PeerPresence[] }) => void;
  'presence:update': (payload: { peer: PeerPresence }) => void;

  'chat:message': (payload: {
    id: string;
    projectId: string;
    userId: string;
    username: string;
    avatarColor: string;
    content: string;
    createdAt: string;
  }) => void;

  'file:created': (payload: { file: FileNode }) => void;
  'file:renamed': (payload: { file: FileNode }) => void;
  'file:deleted': (payload: { file: FileNode }) => void;

  'execution:started': (payload: ExecutionStartedEvent) => void;
  'execution:stdout': (payload: ExecutionOutputEvent) => void;
  'execution:stderr': (payload: ExecutionOutputEvent) => void;
  'execution:exit': (payload: ExecutionExitEvent) => void;
  'execution:rejected': (payload: ExecutionRejectedEvent) => void;

  'snapshot:created': (payload: { snapshot: SnapshotMeta }) => void;
  'snapshot:rollbackApplied': (payload: { snapshotId: string; filePath: string; restoredBy: string }) => void;

  'error': (payload: { code: string; message: string }) => void;
}

// Runtime-validated terrain: server handlers re-validate every payload with
// the Zod schemas from ./schemas before trusting models from ./models.
