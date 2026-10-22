import type { Language } from '@devcollab/shared';
import { env } from '../config/env.js';
import { MAX_OUTPUT_BYTES, type ExecuteOptions, type ExecuteResult } from './executor.js';

interface PistonRunResult {
  stdout: string;
  stderr: string;
  output: string;
  code: number | null;
  signal: string | null;
}

interface PistonResponse {
  language: string;
  version: string;
  run: PistonRunResult;
  message?: string;
}

export function getPistonLanguageConfig(lang: Language): { language: string; version: string } {
  switch (lang) {
    case 'PYTHON':
      return { language: 'python', version: '3.10.0' };
    case 'TYPESCRIPT':
      return { language: 'typescript', version: '5.0.3' };
    case 'JAVASCRIPT':
      return { language: 'javascript', version: '18.15.0' };
    default:
      throw new Error(`Unsupported execution language for Piston: ${lang}`);
  }
}

/**
 * Executes code via the remote Piston API sandbox (e.g. hosted on Render without Docker socket).
 * Enforces timeout, output limit, and dispatches real-time stdout/stderr streams.
 */
export async function executeViaPiston(options: ExecuteOptions): Promise<ExecuteResult> {
  const { language, version } = getPistonLanguageConfig(options.language);
  const timeoutMs = options.timeoutMs ?? env.EXECUTION_TIMEOUT_MS ?? 7000;
  const startTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let timedOut = false;
  let res: Response;
  try {
    res = await fetch(env.PISTON_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        language,
        version,
        files: [{ content: options.code }],
        run_timeout: Math.min(timeoutMs, 10000),
      }),
      signal: controller.signal,
    });
  } catch (error: any) {
    clearTimeout(timer);
    const durationMs = Date.now() - startTime;
    if (error?.name === 'AbortError' || controller.signal.aborted) {
      timedOut = true;
      const timeoutMsg = `\n[Execution timed out after ${timeoutMs}ms]\n`;
      options.onStderr?.(timeoutMsg);
      return {
        exitCode: 137,
        durationMs,
        timedOut: true,
        stdout: '',
        stderr: timeoutMsg,
      };
    }
    throw new Error(`Piston API execution request failed: ${error?.message || 'Network error'}`);
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startTime;

  if (!res.ok) {
    const errorBody = await res.text().catch(() => '');
    throw new Error(`Piston API returned error HTTP ${res.status}: ${errorBody}`);
  }

  const data = (await res.json()) as PistonResponse;

  if (data.message && !data.run) {
    throw new Error(`Piston error: ${data.message}`);
  }

  let rawStdout = data.run?.stdout || '';
  let rawStderr = data.run?.stderr || '';

  // Enforce MAX_OUTPUT_BYTES limit
  let stdoutTruncated = false;
  let stderrTruncated = false;

  if (rawStdout.length > MAX_OUTPUT_BYTES) {
    rawStdout = rawStdout.slice(0, MAX_OUTPUT_BYTES);
    stdoutTruncated = true;
  }
  if (rawStderr.length > MAX_OUTPUT_BYTES) {
    rawStderr = rawStderr.slice(0, MAX_OUTPUT_BYTES);
    stderrTruncated = true;
  }

  if (stdoutTruncated) {
    rawStdout += '\n[STDOUT TRUNCATED: Exceeded 500KB limit]';
  }
  if (stderrTruncated) {
    rawStderr += '\n[STDERR TRUNCATED: Exceeded 500KB limit]';
  }

  // Stream chunks to callbacks if provided
  if (rawStdout && options.onStdout) {
    options.onStdout(rawStdout);
  }
  if (rawStderr && options.onStderr) {
    options.onStderr(rawStderr);
  }

  const exitCode = data.run?.code ?? (data.run?.signal ? 137 : 0);

  return {
    exitCode,
    durationMs,
    timedOut: Boolean(data.run?.signal === 'SIGKILL' || timedOut),
    stdout: rawStdout,
    stderr: rawStderr,
  };
}
