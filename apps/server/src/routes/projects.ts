import { Router } from 'express';
import { createProjectSchema, joinProjectSchema, parseOr, roleSchema } from '@devcollab/shared';
import type { Role } from '@devcollab/shared';
import type { RouteDeps } from './deps.js';
import { permissionGuard, requestProjectId, requirePersona } from '../middleware/auth.js';
import type { ProjectRecord } from '../store/types.js';

function toProjectSummary(
  record: ProjectRecord,
  role: Role,
  counts: { memberCount: number; fileCount: number },
) {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    role,
    memberCount: counts.memberCount,
    fileCount: counts.fileCount,
    // Hidden from VIEWER roster responses.
    inviteCode: role === 'VIEWER' ? undefined : record.inviteCode,
  };
}

export function createProjectsRouter(deps: RouteDeps): Router {
  const router = Router();
  router.use(requirePersona);

  // List all projects the persona belongs to
  router.get('/', async (req, res, next) => {
    try {
      const projects = await deps.projects.listFor(req.persona.id);
      res.json({ data: projects });
    } catch (error: unknown) {
      next(error);
    }
  });

  // Create project - creator auto-becomes OWNER
  router.post('/', async (req, res, next) => {
    try {
      const parsed = parseOr(createProjectSchema, req.body);
      if (!parsed.ok) {
        res.status(422).json({ error: { code: 'validation_error', message: parsed.error } });
        return;
      }
      const created = await deps.projects.create({
        ownerId: req.persona.id,
        name: parsed.data.name,
        description: parsed.data.description,
      });
      const role: Role | null = await deps.membership.get(created.id, req.persona.id);
      res
        .status(201)
        .json({ data: toProjectSummary(created, role ?? 'OWNER', { memberCount: 1, fileCount: 0 }) });
    } catch (error: unknown) {
      next(error);
    }
  });

  // Join project via invite code
  router.post('/join', async (req, res, next) => {
    try {
      const parsed = parseOr(joinProjectSchema, req.body);
      if (!parsed.ok) {
        res.status(422).json({ error: { code: 'validation_error', message: parsed.error } });
        return;
      }
      const project = await deps.projects.findByInviteCode(parsed.data.inviteCode);
      if (!project) {
        res.status(404).json({ error: { code: 'not_found', message: 'Invalid invite code' } });
        return;
      }
      const existing = await deps.membership.get(project.id, req.persona.id);
      const member = existing
        ? null
        : await deps.projects.addMember(project.id, req.persona.id, 'EDITOR');
      const [members, files] = await Promise.all([
        deps.membership.list(project.id),
        deps.files.list(project.id),
      ]);
      res.status(existing ? 200 : 201).json({
        data: toProjectSummary(
          project,
          existing ?? member?.role ?? 'EDITOR',
          { memberCount: members.length, fileCount: files.length },
        ),
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  // Project detail (any member incl. viewer)
  router.get('/:projectId', permissionGuard('file:read', deps.membership), async (req, res, next) => {
    try {
      const project = await deps.projects.get(requestProjectId(req));
      if (!project) {
        res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
        return;
      }
      const [members, files] = await Promise.all([
        deps.membership.list(project.id),
        deps.files.list(project.id),
      ]);
      res.json({
        data: {
          ...toProjectSummary(project, req.projectRole ?? 'VIEWER', {
            memberCount: members.length,
            fileCount: files.length,
          }),
          members: members.map((m) => ({
            userId: m.userId,
            username: m.username,
            avatarColor: m.avatarColor,
            role: m.role,
            joinedAt: m.joinedAt.toISOString(),
          })),
          files: files.map((f) => ({
            id: f.id,
            path: f.path,
            language: f.language,
            updatedAt: f.updatedAt.toISOString(),
          })),
        },
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  // Get invite code (any member)
  router.get('/:projectId/invite', permissionGuard('file:read', deps.membership), async (req, res, next) => {
    try {
      const project = await deps.projects.get(requestProjectId(req));
      if (!project) {
        res.status(404).json({ error: { code: 'not_found', message: 'Project not found' } });
        return;
      }
      res.json({ data: { inviteCode: project.inviteCode } });
    } catch (error: unknown) {
      next(error);
    }
  });

  // Change a member's role - Owners only
  router.patch(
    '/:projectId/members/:userId',
    permissionGuard('member:manage', deps.membership),
    async (req, res, next) => {
      try {
        const projectId = requestProjectId(req);
        const userId = req.params.userId;
        const parsed = parseOr(roleSchema, req.body?.role);
        if (!userId) {
          res.status(400).json({ error: { code: 'bad_request', message: 'userId is required' } });
          return;
        }
        if (!parsed.ok) {
          res.status(422).json({ error: { code: 'validation_error', message: parsed.error } });
          return;
        }
        const updated = await deps.projects.setRole(projectId, userId, parsed.data);
        res.json({
          data: {
            userId: updated.userId,
            username: updated.username,
            avatarColor: updated.avatarColor,
            role: updated.role,
            joinedAt: updated.joinedAt.toISOString(),
          },
        });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  return router;
}
