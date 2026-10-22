import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';
import { registerRouters, storeErrorHandler } from './index.js';
import { requirePersona } from '../middleware/auth.js';
import type { FileRecord, SnapshotRecord } from '../store/types.js';
import { StoreError } from '../store/types.js';
import type { SnapshotDocBridge } from '../yjs/room-manager.js';

// ---------------------------------------------------------------------------
// In-memory fake stores - deterministic, DB-free route verification.
// ---------------------------------------------------------------------------

function makeFile(id: string, path: string, projectId = 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0', language: FileRecord['language'] = 'TYPESCRIPT'): FileRecord {
  return { id, projectId, path, language, updatedAt: new Date() };
}

type MemberRow = { userId: string; role: FileRecord['language'] extends never ? never : string };

function buildApp(docs: SnapshotDocBridge) {
  const files: FileRecord[] = [makeFile('file-1', 'index.ts')];
  const members: MemberRow[] = [
    { userId: 'persona-alice', role: 'OWNER' },
    { userId: 'persona-bob', role: 'EDITOR' },
    { userId: 'persona-charlie', role: 'VIEWER' },
  ];
  const snapshotRows: SnapshotRecord[] = [];
  let snapshotCounter = 0;

  const projects = {
    async create(input: { ownerId: string; name: string; description?: string }) {
      return { id: 'proj-new', name: input.name, description: input.description ?? null, inviteCode: 'inv-new' };
    },
    async listFor(userId: string) {
      const roleFor = members.find((m) => m.userId === userId)?.role;
      if (!roleFor) return [];
      return [{ id: 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0', name: 'Demo', description: null, role: roleFor, memberCount: 3, fileCount: files.length }];
    },
    async get(projectId: string) {
      return projectId === 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0'
        ? { id: 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0', name: 'Demo', description: null, inviteCode: 'inv-demo' }
        : null;
    },
    async findByInviteCode(code: string) {
      return code === 'inv-demo'
        ? { id: 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0', name: 'Demo', description: null, inviteCode: 'inv-demo' }
        : null;
    },
    async addMember(projectId: string, userId: string, role: string) {
      members.push({ userId, role });
      return { userId, role, joinedAt: new Date(), username: userId, avatarColor: '#000' };
    },
    async setRole(_projectId: string, userId: string, role: string) {
      const member = members.find((m) => m.userId === userId);
      if (!member) throw Object.assign(new Error('missing'), { code: 'P2025' });
      member.role = role;
      return { userId, role, joinedAt: new Date(), username: userId, avatarColor: '#000' };
    },
  } as never;

  const membership = {
    async get(_projectId: string, userId: string) {
      return members.find((m) => m.userId === userId)?.role ?? null;
    },
    async list() {
      return members.map((m) => ({ ...m, joinedAt: new Date(), username: m.userId, avatarColor: '#000' }));
    },
  } as never;

  const filesStore = {
    async create(input: { projectId: string; path: string; language: FileRecord['language'] }) {
      if (files.some((f) => f.path === input.path)) {
        throw new StoreError('conflict', `A file already exists at ${input.path}`);
      }
      if (input.path === 'boom.ts') {
        throw new Error('unexpected');
      }
      const file = makeFile(`file-${files.length + 1}`, input.path, input.projectId, input.language);
      files.push(file);
      return file;
    },
    async rename(_projectId: string, fileId: string, path: string) {
      const file = files.find((f) => f.id === fileId);
      if (!file) return null;
      file.path = path;
      return file;
    },
    async delete(projectId: string, fileId: string) {
      const index = files.findIndex((f) => f.id === fileId && f.projectId === projectId);
      if (index === -1) return null;
      return files.splice(index, 1)[0];
    },
    async list(projectId: string) {
      return files.filter((f) => f.projectId === projectId);
    },
    async get(projectId: string, fileId: string) {
      return files.find((f) => f.id === fileId && f.projectId === projectId) ?? null;
    },
  } as never;

  const snapshots = {
    async create(input: {
      projectId: string;
      fileId: string;
      createdById: string;
      label: string;
      yjsBinary: Buffer;
      readableText: string;
    }) {
      const record: SnapshotRecord = {
        id: `00000000-0000-4000-8000-00000000000${snapshotCounter + 1}`,
        projectId: input.projectId,
        fileId: input.fileId,
        filePath: 'index.ts',
        createdById: input.createdById,
        createdByName: input.createdById,
        label: input.label,
        createdAt: new Date(),
        sizeBytes: input.yjsBinary.byteLength,
        yjsBinary: input.yjsBinary,
        readableText: input.readableText,
      };
      snapshotCounter += 1;
      snapshotRows.push(record);
      return record;
    },
    async list() {
      return snapshotRows.map(({ yjsBinary: _y, readableText: _r, ...rest }) => rest);
    },
    async get(_projectId: string, snapshotId: string) {
      return snapshotRows.find((s) => s.id === snapshotId) ?? null;
    },
  } as never;

  const app = express();
  app.use(express.json());
  const root = Router();
  registerRouters(root, {
    projects: projects,
    membership: membership,
    files: filesStore,
    snapshots: snapshots,
    docs,
  });
  app.use(root);
  app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const translated = storeErrorHandler(error);
    if (translated) {
      res.status(translated.status).json(translated.body);
      return;
    }
    next(error);
  });
  return { app, snapshotRows };
}

function headerFor(persona: string): Record<string, string> {
  return { 'x-persona-id': persona };
}

describe('DevCollab REST surface', () => {
  it('rejects requests without a known persona (401 envelope)', async () => {
    const app = express();
    app.get('/ping', requirePersona, (_req, res) => {
      res.json({ ok: true });
    });
    const res = await request(app).get('/ping');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('creates a file for EDITOR but enforces VIEWER read-only', async () => {
    const { app } = buildApp({ isRoomOpen: () => false } as never);
    const editorRes = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files')
      .set(headerFor('persona-bob'))
      .send({ projectId: 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0', path: 'app/main.ts', language: 'TYPESCRIPT' });
    expect(editorRes.status).toBe(201);
    expect(editorRes.body.data.path).toBe('app/main.ts');

    const viewerRes = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files')
      .set(headerFor('persona-charlie'))
      .send({ projectId: 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0', path: 'should-not-exist.ts', language: 'TYPESCRIPT' });
    expect(viewerRes.status).toBe(403);
    expect(viewerRes.body.error.message).toContain('VIEWER');

    const conflictRes = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files')
      .set(headerFor('persona-bob'))
      .send({ projectId: 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0', path: 'app/main.ts', language: 'TYPESCRIPT' });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('conflict');
  });

  it('creates an uploaded file with initial content for EDITOR', async () => {
    const { app } = buildApp({ isRoomOpen: () => false } as never);
    const res = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files')
      .set(headerFor('persona-bob'))
      .send({
        projectId: 'e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0',
        path: 'uploaded.py',
        language: 'PYTHON',
        content: 'print("uploaded code from file")',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.path).toBe('uploaded.py');
    expect(res.body.data.language).toBe('PYTHON');
  });

  it('captures a snapshot from the live document text', async () => {
    const live = { text: 'const current = true;' };
    const { app } = buildApp(buildDocBridge(live));

    const created = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files/file-1/snapshots')
      .set(headerFor('persona-bob'))
      .send({ label: 'before refactor' });
    expect(created.status).toBe(201);
    expect(created.body.data.label).toBe('before refactor');

    const listed = await request(app)
      .get('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files/file-1/snapshots')
      .set(headerFor('persona-charlie'));
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].filePath).toBe('index.ts');
  });

  it('applies NON-destructive rollback to the live doc (owner ok, viewer denied)', async () => {
    const live = { text: 'const current = true;' };
    const { app } = buildApp(buildDocBridge(live));

    const created = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files/file-1/snapshots')
      .set(headerFor('persona-bob'))
      .send({ label: 'checkpoint' });
    expect(created.status).toBe(201);

    live.text = 'const mutated = false;';

    const ownerRollback = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files/file-1/snapshots/00000000-0000-4000-8000-000000000001/rollback')
      .set(headerFor('persona-alice'));
    expect(ownerRollback.status).toBe(200);
    expect(ownerRollback.body.data.snapshotId).toBe('00000000-0000-4000-8000-000000000001');
    expect(live.text).toBe('const current = true;');

    const viewerRollback = await request(app)
      .post('/api/projects/e0e0e0e0-0e0e-4e0e-8e0e-00000000e0e0/files/file-1/snapshots/00000000-0000-4000-8000-000000000001/rollback')
      .set(headerFor('persona-charlie'));
    expect(viewerRollback.status).toBe(403);
  });

  it('translates typed store errors centrally', () => {
    const translated = storeErrorHandler(Object.assign(new Error('dup'), { name: 'StoreError', code: 'conflict' }));
    expect(translated?.status).toBe(409);
    expect(translated?.body.error.code).toBe('conflict');
    expect(storeErrorHandler(new Error('unrelated'))).toBeNull();
  });

  it('handles AI copilot completions with explain and test generation', async () => {
    const live = { text: 'function add(a: number, b: number) { return a + b; }' };
    const { app } = buildApp(buildDocBridge(live));

    // Rejects unauthenticated
    const unauth = await request(app).post('/api/ai/complete').send({ prompt: 'Explain this' });
    expect(unauth.status).toBe(401);

    // Explain code
    const explainRes = await request(app)
      .post('/api/ai/complete')
      .set(headerFor('persona-bob'))
      .send({
        prompt: 'Explain this function',
        code: live.text,
        language: 'TYPESCRIPT',
        action: 'explain',
      });
    expect(explainRes.status).toBe(200);
    expect(explainRes.body.data.response).toContain('Code Explanation');

    // Generate unit tests
    const testRes = await request(app)
      .post('/api/ai/complete')
      .set(headerFor('persona-alice'))
      .send({
        prompt: 'Generate unit tests',
        code: live.text,
        language: 'TYPESCRIPT',
        action: 'test',
      });
    expect(testRes.status).toBe(200);
    expect(testRes.body.data.suggestedCode).toBeDefined();
    expect(testRes.body.data.suggestedCode).toContain('describe');
  });
});

function buildDocBridge(live: { text: string }): SnapshotDocBridge {
  return {
    isRoomOpen: () => true,
    getText: () => Promise.resolve(live.text),
    getBinaryState: () => Promise.resolve(new TextEncoder().encode(live.text)),
    applyRollback: (_projectId: string, _fileId: string, targetText: string) => {
      live.text = targetText;
      return Promise.resolve();
    },
    destroyRoom: () => Promise.resolve(),
  };
}
