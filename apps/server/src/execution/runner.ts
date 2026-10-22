import type { ExecuteOptions, ExecuteResult } from './executor.js';
import { executeInSandbox } from './executor.js';
import { executeViaPiston } from './piston.js';
import { executeViaJudge0 } from './judge0.js';
import { executeViaWandbox } from './wandbox.js';
import { env } from '../config/env.js';

export interface UnifiedExecutionResult extends ExecuteResult {
  backend: 'docker' | 'piston' | 'judge0' | 'wandbox';
}

/**
 * Dispatches code execution based on EXECUTION_BACKEND:
 * - 'docker': Local isolated Docker container (default for local runs).
 * - 'wandbox': Public Wandbox sandbox, keyless with native Python/JS/TS runtimes (used on Render).
 * - 'judge0': Public Judge0 CE sandbox (keyless).
 * - 'piston': Remote hosted Piston execution sandbox (whitelist-only since 2026).
 * - 'auto': Tries Docker first, then Wandbox, then Judge0, then Piston.
 */
export async function executeCode(options: ExecuteOptions): Promise<UnifiedExecutionResult> {
  const backend = env.EXECUTION_BACKEND;

  if (backend === 'piston') {
    const res = await executeViaPiston(options);
    return { ...res, backend: 'piston' };
  }

  if (backend === 'judge0') {
    const res = await executeViaJudge0(options);
    return { ...res, backend: 'judge0' };
  }

  if (backend === 'wandbox') {
    const res = await executeViaWandbox(options);
    return { ...res, backend: 'wandbox' };
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
    console.warn('[runner] Docker execution failed or unavailable, falling back to Wandbox:', err?.message);
    try {
      const res = await executeViaWandbox(options);
      return { ...res, backend: 'wandbox' };
    } catch (wandboxErr: any) {
      console.warn('[runner] Wandbox execution failed, falling back to Judge0:', wandboxErr?.message);
      try {
        const res = await executeViaJudge0(options);
        return { ...res, backend: 'judge0' };
      } catch (judge0Err: any) {
        console.warn('[runner] Judge0 execution failed, falling back to Piston API:', judge0Err?.message);
        const res = await executeViaPiston(options);
        return { ...res, backend: 'piston' };
      }
    }
  }
}
