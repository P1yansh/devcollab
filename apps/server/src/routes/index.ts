import type { Router } from 'express';
import type { RouteDeps } from './deps.js';
import { createFilesRouter } from './files.js';
import { createProjectsRouter } from './projects.js';
import { createSnapshotsRouter } from './snapshots.js';
import { createAiRouter } from './ai.js';
import type { StoreError } from '../store/types.js';

/** Error middleware translating typed StoreErrors into HTTP semantics. */
export function storeErrorHandler(error: unknown): {
  status: number;
  body: { error: { code: string; message: string } };
} | null {
  if (error && typeof error === 'object' && (error as StoreError).name === 'StoreError') {
    const err = error as StoreError;
    const status = err.code === 'conflict' ? 409 : err.code === 'not-found' ? 404 : 500;
    const code = err.code === 'conflict' ? 'conflict' : err.code === 'not-found' ? 'not_found' : 'internal_error';
    return { status, body: { error: { code, message: err.message } } };
  }
  return null;
}

export function registerRouters(root: Router, deps: RouteDeps): void {
  root.use('/api/projects/:projectId/files', createFilesRouter(deps));
  root.use('/api/projects/:projectId/files', createSnapshotsRouter(deps));
  root.use('/api/projects', createProjectsRouter(deps));
  root.use('/api/ai', createAiRouter());
}
