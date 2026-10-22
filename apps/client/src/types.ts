import type {
  DemoPersona,
  FileNode,
  Language,
  MemberSummary,
  PeerPresence,
  Role,
  SnapshotMeta,
} from '@devcollab/shared';

export interface ChatItem {
  id: string;
  projectId: string;
  userId: string;
  username: string;
  avatarColor: string;
  content: string;
  createdAt: string;
}

export interface ExecutionState {
  status: 'idle' | 'running' | 'completed' | 'failed' | 'timedOut';
  executionId: string | null;
  output: string;
  exitCode: number | null;
  durationMs: number | null;
  backend?: 'docker' | 'piston';
  startedBy?: { username: string; avatarColor: string };
  errorMessage?: string;
}

export interface ProjectState {
  id: string;
  name: string;
  inviteCode: string;
  role: Role;
  files: FileNode[];
  members: MemberSummary[];
  snapshots: SnapshotMeta[];
}
