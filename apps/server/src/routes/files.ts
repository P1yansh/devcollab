import { Router } from 'express';
import { createFileSchema, parseOr, renameFileSchema, uuidSchema } from '@devcollab/shared';
import type { RouteDeps } from './deps.js';
import { permissionGuard, requestProjectId, requirePersona } from '../middleware/auth.js';
import type { FileRecord } from '../store/types.js';

function toFileDto(record: FileRecord) {
  return {
    id: record.id,
    projectId: record.projectId,
    path: record.path,
    language: record.language,
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createFilesRouter(deps: RouteDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(requirePersona);

  // List files - any project member (VIEWERs included)
  router.get(
    '/',
    permissionGuard('file:read', deps.membership),
    async (req, res, next) => {
      try {
        const files = await deps.files.list(requestProjectId(req));
        res.json({ data: files.map(toFileDto) });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  // Create file - Editors and Owners
  router.post(
    '/',
    permissionGuard('file:create', deps.membership),
    async (req, res, next) => {
      try {
        const parsed = parseOr(createFileSchema, req.body);
        if (!parsed.ok) {
          res.status(422).json({ error: { code: 'validation_error', message: parsed.error } });
          return;
        }
        const routeProjectId = requestProjectId(req);
        if (parsed.data.projectId !== routeProjectId) {
          res.status(400).json({
            error: { code: 'bad_request', message: 'projectId in body must match route parameter' },
          });
          return;
        }
        const project = await deps.projects.get(routeProjectId);
        if (!project) {
          res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
          return;
        }
        const created = await deps.files.create({
          projectId: parsed.data.projectId,
          path: parsed.data.path,
          language: parsed.data.language,
          content: parsed.data.content,
        });
        res.status(201).json({ data: toFileDto(created) });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  // Rename file
  router.patch(
    '/:fileId',
    permissionGuard('file:update', deps.membership),
    async (req, res, next) => {
      try {
        const projectId = requestProjectId(req);
        const fileId = req.params.fileId;
        if (!fileId || !uuidSchema.safeParse(fileId).success) {
          res.status(400).json({ error: { code: 'bad_request', message: 'fileId is required' } });
          return;
        }
        const parsed = parseOr(renameFileSchema.pick({ path: true }), req.body);
        if (!parsed.ok) {
          res.status(422).json({ error: { code: 'validation_error', message: parsed.error } });
          return;
        }
        const updated = await deps.files.rename(projectId, fileId, parsed.data.path);
        if (!updated) {
          res.status(404).json({ error: { code: 'not_found', message: 'File not found' } });
          return;
        }
        res.json({ data: toFileDto(updated) });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  // Delete file (snapshots cascade in DB; open collaborative rooms are destroyed)
  router.delete(
    '/:fileId',
    permissionGuard('file:delete', deps.membership),
    async (req, res, next) => {
      try {
        const projectId = requestProjectId(req);
        const fileId = req.params.fileId;
        if (!fileId) {
          res.status(400).json({ error: { code: 'bad_request', message: 'fileId is required' } });
          return;
        }
        const deleted = await deps.files.delete(projectId, fileId);
        if (!deleted) {
          res.status(404).json({ error: { code: 'not_found', message: 'File not found' } });
          return;
        }
        // Kill any open collaborative session so a late flush cannot resurrect it.
        if (deps.docs.isRoomOpen(projectId, fileId)) {
          await deps.docs.destroyRoom(projectId, fileId);
        }
        res.status(204).send();
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}
