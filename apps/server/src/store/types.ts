import type { Language, ProjectSummary, Role, SnapshotMeta } from '@devcollab/shared';

// ---------------------------------------------------------------- Persistence ports.
// Routes and services depend on these interfaces; Prisma-backed adapters live
// under src/store/prisma/. In-memory fakes (used in tests) implement the same
// contracts, so verification never requires a database.

export type ProjectRecord = {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
};

export type ProjectListEntry = ProjectSummary;

export type MemberRecord = {
  userId: string;
  username: string;
  avatarColor: string;
  role: Role;
  joinedAt: Date;
};

export type FileRecord = {
  id: string;
  projectId: string;
  path: string;
  language: Language;
  updatedAt: Date;
};

export type SnapshotRecord = {
  id: string;
  projectId: string;
  fileId: string;
  filePath: string;
  createdById: string;
  createdByName: string;
  label: string;
  createdAt: Date;
  sizeBytes: number;
  yjsBinary: Buffer;
  readableText: string;
};

export interface ProjectStore {
  create(input: {
    ownerId: string;
    name: string;
    description?: string;
    inviteCode?: string;
  }): Promise<ProjectRecord>;
  listFor(userId: string): Promise<ProjectListEntry[]>;
  get(projectId: string): Promise<ProjectRecord | null>;
  findByInviteCode(inviteCode: string): Promise<ProjectRecord | null>;
  addMember(projectId: string, userId: string, role: Role): Promise<MemberRecord>;
  setRole(projectId: string, userId: string, role: Role): Promise<MemberRecord>;
}

export interface MembershipStore {
  get(projectId: string, userId: string): Promise<Role | null>;
  list(projectId: string): Promise<MemberRecord[]>;
}

export interface FileStore {
  create(input: { projectId: string; path: string; language: Language; content?: string }): Promise<FileRecord>;
  rename(projectId: string, fileId: string, path: string): Promise<FileRecord | null>;
  delete(projectId: string, fileId: string): Promise<FileRecord | null>;
  list(projectId: string): Promise<FileRecord[]>;
  get(projectId: string, fileId: string): Promise<FileRecord | null>;
}

export interface SnapshotStore {
  create(input: {
    projectId: string;
    fileId: string;
    createdById: string;
    label: string;
    yjsBinary: Buffer;
    readableText: string;
  }): Promise<SnapshotRecord>;
  list(projectId: string, fileId: string): Promise<Array<Omit<SnapshotRecord, 'yjsBinary' | 'readableText'>>>;
  get(projectId: string, snapshotId: string): Promise<SnapshotRecord | null>;
}

/** Loads/saves the canonical CRDT state for a project file. */
export interface DocStateStore {
  load(fileId: string): Promise<{ projectId: string; state: Buffer | null } | null>;
  save(fileId: string, state: Buffer): Promise<void>;
}

export interface AllStores {
  projects: ProjectStore;
  membership: MembershipStore;
  files: FileStore;
  snapshots: SnapshotStore;
}

// ---------------------------------------------------------------- Error contract.

export type StoreErrorCode = 'conflict' | 'not-found' | 'unknown';

/** Transport-agnostic storage failure. Routes translate kind -> HTTP status. */
export class StoreError extends Error {
  constructor(
    public readonly code: StoreErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
