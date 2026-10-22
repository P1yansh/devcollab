import { prisma } from '../config/prisma.js';
import { runStore } from './prisma-errors.js';
import * as Y from 'yjs';
import type {
  FileRecord,
  FileStore,
  MemberRecord,
  MembershipStore,
  ProjectRecord,
  ProjectStore,
  SnapshotRecord,
  SnapshotStore,
} from './types.js';
import type { Language, ProjectSummary, Role } from '@devcollab/shared';
import type { DocStateStore } from './types.js';

export class PrismaProjectStore implements ProjectStore {
  async create(input: {
    ownerId: string;
    name: string;
    description?: string;
    inviteCode?: string;
  }): Promise<ProjectRecord> {
    return runStore(
      () =>
        prisma.project.create({
          data: {
            name: input.name,
            description: input.description,
            inviteCode: input.inviteCode,
            members: { create: { userId: input.ownerId, role: 'OWNER' } },
          },
          select: { id: true, name: true, description: true, inviteCode: true },
        }),
      'Project creation failed',
    );
  }

  async listFor(userId: string): Promise<ProjectSummary[]> {
    const memberships = await runStore(
      () =>
        prisma.projectMember.findMany({
          where: { userId },
          select: {
            role: true,
            project: {
              select: {
                id: true,
                name: true,
                description: true,
                inviteCode: true,
                _count: { select: { members: true, files: true } },
              },
            },
          },
          orderBy: { joinedAt: 'asc' },
        }),
      'Failed to list projects',
    );
    return memberships.map((m) => ({
      id: m.project.id,
      name: m.project.name,
      description: m.project.description,
      role: m.role,
      memberCount: m.project._count.members,
      fileCount: m.project._count.files,
      inviteCode: m.role === 'VIEWER' ? undefined : m.project.inviteCode,
    }));
  }

  async get(projectId: string): Promise<ProjectRecord | null> {
    return runStore(
      () => prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, description: true, inviteCode: true } }),
      'Failed to load project',
    );
  }

  async findByInviteCode(inviteCode: string): Promise<ProjectRecord | null> {
    return runStore(
      () => prisma.project.findUnique({ where: { inviteCode }, select: { id: true, name: true, description: true, inviteCode: true } }),
      'Failed to lookup invite code',
    );
  }

  async addMember(projectId: string, userId: string, role: Role): Promise<MemberRecord> {
    const member = await runStore(
      () =>
        prisma.projectMember.create({
          data: { projectId, userId, role },
          select: { userId: true, role: true, joinedAt: true, user: { select: { username: true, avatarColor: true } } },
        }),
      'Could not join project',
    );
    return { userId: member.userId, role: member.role, joinedAt: member.joinedAt, username: member.user.username, avatarColor: member.user.avatarColor };
  }

  async setRole(projectId: string, userId: string, role: Role): Promise<MemberRecord> {
    const member = await runStore(
      () =>
        prisma.projectMember.update({
          where: { projectId_userId: { projectId, userId } },
          data: { role },
          select: { userId: true, role: true, joinedAt: true, user: { select: { username: true, avatarColor: true } } },
        }),
      'Could not update membership',
    );
    return { userId: member.userId, role: member.role, joinedAt: member.joinedAt, username: member.user.username, avatarColor: member.user.avatarColor };
  }
}

export class PrismaMembershipStore implements MembershipStore {
  async get(projectId: string, userId: string): Promise<Role | null> {
    const member = await runStore(
      () => prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
      }),
      'Failed to load membership',
    );
    return member?.role ?? null;
  }

  async list(projectId: string): Promise<MemberRecord[]> {
    const members = await runStore(
      () =>
        prisma.projectMember.findMany({
          where: { projectId },
          orderBy: { joinedAt: 'asc' },
          select: { userId: true, role: true, joinedAt: true, user: { select: { username: true, avatarColor: true } } },
        }),
      'Failed to list members',
    );
    return members.map((m) => ({
      userId: m.userId,
      role: m.role,
      joinedAt: m.joinedAt,
      username: m.user.username,
      avatarColor: m.user.avatarColor,
    }));
  }
}

function toFileRecord(row: { id: string; projectId: string; path: string; language: Language; updatedAt: Date }): FileRecord {
  return { id: row.id, projectId: row.projectId, path: row.path, language: row.language, updatedAt: row.updatedAt };
}

function encodeInitialDoc(content: string): Buffer {
  const doc = new Y.Doc();
  const ytext = doc.getText('monaco');
  ytext.insert(0, content);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return Buffer.from(update);
}

export class PrismaFileStore implements FileStore {
  async create(input: { projectId: string; path: string; language: Language; content?: string }): Promise<FileRecord> {
    const yjsState = input.content ? encodeInitialDoc(input.content) : null;
    const row = await runStore(
      () =>
        prisma.projectFile.create({
          data: {
            projectId: input.projectId,
            path: input.path,
            language: input.language,
            yjsState,
          },
        }),
      `A file already exists at ${input.path}`,
    );
    return toFileRecord(row);
  }

  async rename(projectId: string, fileId: string, path: string): Promise<FileRecord | null> {
    const existing = await runStore(
      () => prisma.projectFile.findUnique({ where: { id: fileId }, select: { id: true, projectId: true } }),
      'Failed to find file for rename',
    );
    if (!existing || existing.projectId !== projectId) return null;

    const row = await runStore(
      () =>
        prisma.projectFile.update({
          where: { id: fileId },
          data: { path },
          select: {
            id: true,
            projectId: true,
            path: true,
            language: true,
            updatedAt: true,
          },
        }),
      `A file already exists at ${path}`,
    );
    return row ? toFileRecord(row) : null;
  }

  async delete(projectId: string, fileId: string): Promise<FileRecord | null> {
    const existing = await prisma.projectFile.findUnique({ where: { id: fileId } });
    if (!existing || existing.projectId !== projectId) return null;
    await runStore(
      () => prisma.projectFile.delete({ where: { id: fileId } }),
      'Failed to delete file',
    );
    return toFileRecord(existing);
  }

  async list(projectId: string): Promise<FileRecord[]> {
    const rows = await runStore(
      () =>
        prisma.projectFile.findMany({
          where: { projectId },
          orderBy: { path: 'asc' },
          select: { id: true, projectId: true, path: true, language: true, updatedAt: true },
        }),
      'Failed to list files',
    );
    return rows.map(toFileRecord);
  }

  async get(projectId: string, fileId: string): Promise<FileRecord | null> {
    const row = await runStore(
      () => prisma.projectFile.findUnique({ where: { id: fileId } }),
      'Failed to load file',
    );
    return row && row.projectId === projectId ? toFileRecord(row) : null;
  }
}

export class PrismaSnapshotStore implements SnapshotStore {
  async create(input: {
    projectId: string;
    fileId: string;
    createdById: string;
    label: string;
    yjsBinary: Buffer;
    readableText: string;
  }): Promise<SnapshotRecord> {
    const row = await runStore(
      () =>
        prisma.snapshot.create({
          data: {
            projectId: input.projectId,
            fileId: input.fileId,
            createdById: input.createdById,
            label: input.label,
            yjsBinary: input.yjsBinary,
            readableText: input.readableText,
          },
          select: {
            id: true,
            projectId: true,
            fileId: true,
            createdById: true,
            label: true,
            createdAt: true,
            yjsBinary: true,
            readableText: true,
            file: { select: { path: true } },
            createdBy: { select: { username: true } },
          },
        }),
      'Failed to create snapshot',
    );
    return {
      id: row.id,
      projectId: row.projectId,
      fileId: row.fileId,
      filePath: row.file.path,
      createdById: row.createdById,
      createdByName: row.createdBy.username,
      label: row.label,
      createdAt: row.createdAt,
      sizeBytes: row.yjsBinary.byteLength,
      yjsBinary: Buffer.from(row.yjsBinary),
      readableText: row.readableText,
    };
  }

  async list(projectId: string, fileId: string) {
    const rows = await runStore(
      () =>
        prisma.snapshot.findMany({
          where: { projectId, fileId },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            projectId: true,
            fileId: true,
            createdById: true,
            label: true,
            createdAt: true,
            yjsBinary: true,
            file: { select: { path: true } },
            createdBy: { select: { username: true } },
          },
        }),
      'Failed to list snapshots',
    );
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      fileId: row.fileId,
      filePath: row.file.path,
      createdById: row.createdById,
      createdByName: row.createdBy.username,
      label: row.label,
      createdAt: row.createdAt,
      sizeBytes: row.yjsBinary.byteLength,
    }));
  }

  async get(projectId: string, snapshotId: string): Promise<SnapshotRecord | null> {
    const row = await runStore(
      () =>
        prisma.snapshot.findUnique({
          where: { id: snapshotId },
          select: {
            id: true,
            projectId: true,
            fileId: true,
            createdById: true,
            label: true,
            createdAt: true,
            yjsBinary: true,
            readableText: true,
            file: { select: { path: true } },
            createdBy: { select: { username: true } },
          },
        }),
      'Failed to load snapshot',
    );
    if (!row || row.projectId !== projectId) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      fileId: row.fileId,
      filePath: row.file.path,
      createdById: row.createdById,
      createdByName: row.createdBy.username,
      label: row.label,
      createdAt: row.createdAt,
      sizeBytes: row.yjsBinary.byteLength,
      yjsBinary: Buffer.from(row.yjsBinary),
      readableText: row.readableText,
    };
  }
}

/** Persistence port for the CRDT engine: raw Yjs binary state load/save. */
export class PrismaDocStateStore implements DocStateStore {
  async load(fileId: string): Promise<{ projectId: string; state: Buffer | null } | null> {
    const row = await runStore(
      () =>
        prisma.projectFile.findUnique({
          where: { id: fileId },
          select: { projectId: true, yjsState: true },
        }),
      'Failed to load document state',
    );
    if (!row) return null;
    return { projectId: row.projectId, state: row.yjsState };
  }

  async save(fileId: string, state: Buffer): Promise<void> {
    // Debounced flush from a room. Late flushes must never resurrect a
    // deleted file, so only update when the row still exists (no upsert).
    const existing = await runStore(
      () => prisma.projectFile.findUnique({ where: { id: fileId }, select: { id: true } }),
      'Failed to check file presence before save',
    );
    if (!existing) return;
    await runStore(
      () => prisma.projectFile.update({ where: { id: fileId }, data: { yjsState: state } }),
      'Failed to persist document state',
    );
  }
}

export function createPrismaStores() {
  return {
    projects: new PrismaProjectStore(),
    membership: new PrismaMembershipStore(),
    files: new PrismaFileStore(),
    snapshots: new PrismaSnapshotStore(),
    docState: new PrismaDocStateStore(),
  };
}

export type PrismaStores = ReturnType<typeof createPrismaStores>;
