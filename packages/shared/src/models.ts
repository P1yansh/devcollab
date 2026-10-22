// ====================================================================
// DevCollab canonical domain model. All wire payloads reference these
// types; behavior-critical invariants live here, not in consumers.
// ====================================================================

// ------------------------------------------------------------------ RBAC

export const ROLES = ['OWNER', 'EDITOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'project:update',
  'member:manage',
  'file:read',
  'file:create',
  'file:update',
  'file:delete',
  'code:execute',
  'snapshot:create',
  'snapshot:rollback',
  'chat:send',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Single authoritative permission matrix. Server and client must both read it here. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    'project:update',
    'member:manage',
    'file:read',
    'file:create',
    'file:update',
    'file:delete',
    'code:execute',
    'snapshot:create',
    'snapshot:rollback',
    'chat:send',
  ],
  EDITOR: [
    'file:read',
    'file:create',
    'file:update',
    'file:delete',
    'code:execute',
    'snapshot:create',
    'snapshot:rollback',
    'chat:send',
  ],
  VIEWER: ['file:read', 'chat:send'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleAtLeast(role: Role, minimum: Role): boolean {
  const rank: Record<Role, number> = { VIEWER: 0, EDITOR: 1, OWNER: 2 };
  return rank[role] >= rank[minimum];
}

// ------------------------------------------------------------------ Files

export const LANGUAGES = ['JAVASCRIPT', 'TYPESCRIPT', 'PYTHON', 'MARKDOWN'] as const;
export type Language = (typeof LANGUAGES)[number];

/** Flat file node; the client assembles the tree presentationally (path.join semantics, POSIX separators). */
export interface FileNode {
  id: string;
  projectId: string;
  path: string;
  language: Language;
  updatedAt: string;
}

// ------------------------------------------------------------------ Personas

/** Seed personas so the recipient can test multiplayer + RBAC immediately with zero external auth. */
export const DEMO_PERSONAS = [
  { id: 'persona-alice', username: 'Alice', role: 'OWNER', avatarColor: '#6366f1' },
  { id: 'persona-bob', username: 'Bob', role: 'EDITOR', avatarColor: '#10b981' },
  { id: 'persona-charlie', username: 'Charlie', role: 'VIEWER', avatarColor: '#f59e0b' },
] as const satisfies readonly { id: string; username: string; role: Role; avatarColor: string }[];

export interface DemoPersona {
  id: string;
  username: string;
  role: Role;
  avatarColor: string;
}

export function getDemoPersona(id: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find((p) => p.id === id);
}

// ------------------------------------------------------------------ Projects & roster

export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  role: Role;
  memberCount: number;
  fileCount: number;
  /** Hidden from VIEWER roster responses. */
  inviteCode?: string;
}

export interface MemberSummary {
  userId: string;
  username: string;
  avatarColor: string;
  role: Role;
  joinedAt: string;
}

// ------------------------------------------------------------------ Live presence

export interface PeerPresence {
  clientId: number;
  userId: string;
  username: string;
  avatarColor: string;
  role: Role;
  fileId: string | null;
  line: number | null;
  column: number | null;
}

// ------------------------------------------------------------------ Snapshots

export interface SnapshotMeta {
  id: string;
  fileId: string;
  filePath: string;
  label: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  sizeBytes: number;
}

// ------------------------------------------------------------------ Execution

export interface ExecutionRequest {
  projectId: string;
  fileId: string;
}

export interface ExecutionStartedEvent {
  executionId: string;
  language: Language;
  backend?: 'docker' | 'piston';
  startedBy: { userId: string; username: string; avatarColor: string };
}

export interface ExecutionOutputEvent {
  executionId: string;
  chunk: string;
}

export interface ExecutionExitEvent {
  executionId: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}

export type ExecutionRejectionReason = 'forbidden' | 'busy' | 'unsupported-language' | 'image-missing' | 'internal';

export interface ExecutionRejectedEvent {
  executionId: string | null;
  reason: ExecutionRejectionReason;
  message: string;
}

// ------------------------------------------------------------------ AI Copilot

export interface AICompletionResponse {
  response: string;
  suggestedCode?: string;
  model: string;
}
