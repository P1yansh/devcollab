import type { Persona } from '../services/personas.js';
import type { Role } from '@devcollab/shared';

declare module 'express-serve-static-core' {
  interface Request {
    persona: Persona;
    /** Resolved role for the request's project (undefined until permissionGuard resolves it). */
    projectRole?: Role;
  }
}
