import type { ExecuteOptions, ExecuteResult } from './executor.js';
import { executeInSandbox } from './executor.js';
import { executeViaPiston } from './piston.js';
import { env } from '../config/env.js';

export interface UnifiedExecutionResult extends ExecuteResult {
  backend: 'docker' | 'piston';
}

/**
 * Dispatches code execution based on EXECUTION_BACKEND:
 * - 'docker': Local isolated Docker container (default for local runs).
 * - 'piston': Remote hosted Piston execution sandbox (used in cloud/Render).
 * - 'auto': Tries Docker first, falls back to Piston if Docker daemon is not accessible.
 */
export async function executeCode(options: ExecuteOptions): Promise<UnifiedExecutionResult> {
  const backend = env.EXECUTION_BACKEND;

  if (backend === 'piston') {
    const res = await executeViaPiston(options);
    return { ...res, backend: 'piston' };
  }

  if (backend === 'docker') {
    const res = await executeInSandbox(options);
    return { ...res, backend: 'docker' };
  }

  // 'auto' mode
  try {
    const res = await executeInSandbox(options);
    return { ...res, backend: 'docker' };
  } catch (err: any) {
    console.warn('[runner] Docker execution failed or unavailable, falling back to Piston API:', err?.message);
    const res = await executeViaPiston(options);
    return { ...res, backend: 'piston' };
  }
}
