import { Router } from 'express';
import { createSnapshotSchema, parseOr, rollbackProjectSchema, uuidSchema } from '@devcollab/shared';
import type { RouteDeps } from './deps.js';
import { permissionGuard, requestProjectId, requirePersona } from '../middleware/auth.js';

function snapshotSummary(row: {
  id: string;
  fileId: string;
  filePath: string;
  createdById: string;
  createdByName: string;
  label: string;
  createdAt: Date;
  sizeBytes?: number;
}) {
  return {
    id: row.id,
    fileId: row.fileId,
    filePath: row.filePath,
    createdById: row.createdById,
    createdByName: row.createdByName,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
    sizeBytes: row.sizeBytes ?? null,
  };
}

export function createSnapshotsRouter(deps: RouteDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requirePersona);

  // List snapshots for a file - any member (VIEWERs included)
  router.get(
    '/:fileId/snapshots',
    permissionGuard('file:read', deps.membership),
    async (req, res, next) => {
      try {
        const projectId = requestProjectId(req);
        const fileId = req.params.fileId;
        if (!fileId) {
          res.status(400).json({ error: { code: 'bad_request', message: 'fileId is required' } });
          return;
        }
        const rows = await deps.snapshots.list(projectId, fileId);
        res.json({ data: rows.map((row) => snapshotSummary({ ...row, createdAt: row.createdAt })) });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  // Capture snapshot from the LIVE room state (Editors + Owners).
  // Reads the active Y.Doc; does not take the room offline.
  router.post(
    '/:fileId/snapshots',
    permissionGuard('snapshot:create', deps.membership),
    async (req, res, next) => {
      try {
        const projectId = requestProjectId(req);
        const fileId = req.params.fileId;
        if (!fileId) {
          res.status(400).json({ error: { code: 'bad_request', message: 'fileId is required' } });
          return;
        }
        const parsed = parseOr(createSnapshotSchema.pick({ label: true }), req.body);
        if (!parsed.ok) {
          res.status(422).json({ error: { code: 'validation_error', message: parsed.error } });
          return;
        }
        const file = await deps.files.get(projectId, fileId);
        if (!file) {
          res.status(404).json({ error: { code: 'not_found', message: 'File not found' } });
          return;
        }
        const [state, text] = await Promise.all([
          deps.docs.getBinaryState(projectId, fileId),
          deps.docs.getText(projectId, fileId),
        ]);
        const created = await deps.snapshots.create({
          projectId,
          fileId,
          createdById: req.persona.id,
          label: parsed.data.label,
          yjsBinary: Buffer.from(state),
          readableText: text,
        });
        res.status(201).json({ data: snapshotSummary(created) });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  // Single snapshot content - used by the History drawer DiffEditor.
  // Returns materialized plain text; binary state stays server-side.
  router.get(
    '/:fileId/snapshots/:snapshotId',
    permissionGuard('file:read', deps.membership),
    async (req, res, next) => {
      try {
        const projectId = requestProjectId(req);
        const fileId = req.params.fileId;
        const snapshotId = req.params.snapshotId;
        if (!fileId || !snapshotId || !uuidSchema.safeParse(snapshotId).success) {
          res.status(400).json({ error: { code: 'bad_request', message: 'fileId and snapshotId are required' } });
          return;
        }
        const snapshot = await deps.snapshots.get(projectId, snapshotId);
        if (!snapshot || snapshot.fileId !== fileId) {
          res.status(404).json({ error: { code: 'not_found', message: 'Snapshot not found' } });
          return;
        }
        res.json({
          data: { ...snapshotSummary(snapshot), readableText: snapshot.readableText },
        });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  // Non-destructive rollback into the LIVE Y.Doc (Owners + Editors).
  router.post(
    '/:fileId/snapshots/:snapshotId/rollback',
    permissionGuard('snapshot:rollback', deps.membership),
    async (req, res, next) => {
      try {
        const projectId = requestProjectId(req);
        const fileId = req.params.fileId;
        const snapshotId = req.params.snapshotId;
        if (!fileId || !snapshotId || !uuidSchema.safeParse(snapshotId).success) {
          res.status(400).json({ error: { code: 'bad_request', message: 'fileId and snapshotId are required' } });
          return;
        }
        const parsed = parseOr(rollbackProjectSchema.pick({ projectId: true }), { projectId });
        if (!parsed.ok) {
          res.status(422).json({ error: { code: 'validation_error', message: parsed.error } });
          return;
        }
        const snapshot = await deps.snapshots.get(projectId, snapshotId);
        if (!snapshot || snapshot.fileId !== fileId) {
          res.status(404).json({ error: { code: 'not_found', message: 'Snapshot not found' } });
          return;
        }
        await deps.docs.applyRollback(projectId, fileId, snapshot.readableText);
        res.json({ data: { snapshotId, filePath: snapshot.filePath, restoredBy: req.persona.id } });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}
