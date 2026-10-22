import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@devcollab/shared';
import { hasPermission, type Permission } from '@devcollab/shared';
import { resolvePersona, type Persona } from '../services/personas.js';
import type { MembershipStore } from '../store/types.js';

export interface MembershipPort {
  get(projectId: string, userId: string): Promise<Role | null>;
}

const PERSONA_HEADER = 'x-persona-id';

function personaFromRequest(req: Request): Persona | undefined {
  const header = req.headers['x-persona-id'] ?? req.headers['x-devcollab-persona'];
  const headerValue = Array.isArray(header) ? header[0] : header;
  const queryValue = typeof req.query.personaId === 'string' ? req.query.personaId : undefined;
  return resolvePersona(headerValue ?? queryValue);
}

/** Reading helpers for downstream layers. */
export function requestPersona(req: Request): Persona {
  return req.persona;
}

/** Mounted project routes must always carry :projectId param. */
export function requestProjectId(req: Request): string {
  const pid = req.params.projectId;
  if (typeof pid !== 'string') {
    throw new TypeError('projectId route parameter is missing');
  }
  return pid;
}

/**
 * Persona-based auth for the demo. True deployments swap this for session
 * verification; the RBAC layer below is identity-provider agnostic.
 */
export function requirePersona(req: Request, res: Response, next: NextFunction): void {
  const persona = personaFromRequest(req);
  if (!persona) {
    res.status(401).json({
      error: { code: 'unauthorized', message: 'Unknown or missing persona. Send x-persona-id header.' },
    });
    return;
  }
  req.persona = persona;
  next();
}

/**
 * Resolves project role and enforces a permission. MembershipStore is
 * injected so tests never touch the database.
 */
export function permissionGuard(permission: Permission, membership: MembershipPort) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      let projectId: string;
      try {
        projectId = requestProjectId(req);
      } catch {
        res.status(400).json({ error: { code: 'bad_request', message: 'projectId is required' } });
        return;
      }
      const userId = req.persona.id;
      const role = await membership.get(projectId, userId);
      if (!role) {
        res.status(403).json({ error: { code: 'forbidden', message: 'You are not a member of this project' } });
        return;
      }
      req.projectRole = role;
      if (!hasPermission(role, permission)) {
        res.status(403).json({
          error: { code: 'forbidden', message: `Role ${role} is not allowed to ${permission}` },
        });
        return;
      }
      next();
    } catch (error: unknown) {
      next(error);
    }
  };
}
