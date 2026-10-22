import type { Language } from '@devcollab/shared';
import { env } from '../config/env.js';
import { MAX_OUTPUT_BYTES, type ExecuteOptions, type ExecuteResult } from './executor.js';

/**
 * Wandbox cloud execution backend (https://wandbox.org/api/compile.json).
 *
 * Keyless public sandbox used for cloud/hosted deploys without a Docker socket.
 * Replaces the Piston backend as the Render execution target after the public
 * Piston API went whitelist-only on 2026-02-15. Wandbox natively supports
 * Python, Node.js and TypeScript runtimes; output arrives in one response
 * (streams once at completion) and long programs are killed server-side, with
 * the client-side AbortController as our additional hard deadline.
 */

const WANDBOX_COMPILERS: Partial<Record<Language, string>> = {
  PYTHON: 'cpython-3.13.8',
  JAVASCRIPT: 'nodejs-20.17.0',
  TYPESCRIPT: 'typescript-5.6.2',
};

export function getWandboxCompiler(lang: Language): string {
  const compiler = WANDBOX_COMPILERS[lang];
  if (!compiler) {
    throw new Error(`Unsupported execution language for Wandbox: ${lang}`);
  }
  return compiler;
}

interface WandboxResult {
  status: string;
  signal: string;
  compiler_error: string;
  compiler_output: string;
  program_output: string;
  program_error: string;
}

// Wandbox compiles/runs on shared infrastructure; give the HTTP round-trip
// head room beyond the execution timeout so the deadline is enforced on the
// run itself, not the transport.
const HTTP_BUFFER_MS = 5000;

function clipOutput(text: string | null | undefined): string {
  if (!text) return '';
  return text.length > MAX_OUTPUT_BYTES ? text.slice(0, MAX_OUTPUT_BYTES) : text;
}

/**
 * Executes code via the Wandbox sandbox. Enforces the execution timeout
 * through an AbortController, clips output to the shared 500 KB limit, and
 * surfaces compiler and program errors on stderr.
 */
export async function executeViaWandbox(options: ExecuteOptions): Promise<ExecuteResult> {
  const timeoutMs = options.timeoutMs ?? env.EXECUTION_TIMEOUT_MS ?? 7000;
  const compiler = getWandboxCompiler(options.language);
  const startTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + HTTP_BUFFER_MS);

  let timedOut = false;
  let response: {
    ok: boolean;
    status: number;
    text: () => Promise<string>;
    json: () => Promise<unknown>;
  } | null = null;
  let transportError: string | null = null;
  try {
    const res = await fetch(env.WANDBOX_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: options.code,
        compiler,
        options: '',
        stdin: '',
        save: false,
      }),
      signal: controller.signal,
    });
    response = res;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      timedOut = true;
    } else {
      transportError = err?.message ?? String(err);
    }
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startTime;

  if (timedOut) {
    return {
      exitCode: 124,
      durationMs,
      timedOut: true,
      stdout: `Execution timed out after ${timeoutMs}ms`,
      stderr: '',
    };
  }

  if (!response) {
    throw new Error(`Wandbox API request failed: ${transportError ?? 'no response'}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Wandbox API HTTP ${response.status}: ${detail}`);
  }

  const result = (await response.json()) as WandboxResult;
  const stdout = clipOutput(result.program_output);
  const stderr = clipOutput(
    [result.program_error, result.compiler_error].filter(Boolean).join('\n'),
  );
  const killedBySandbox = Boolean(result.signal);

  if (stdout) options.onStdout?.(stdout);
  if (stderr) options.onStderr?.(stderr);

  const exitCode = killedBySandbox
    ? 137
    : Number.isFinite(Number(result.status))
      ? Number(result.status)
      : 1;

  return {
    exitCode,
    durationMs,
    timedOut: killedBySandbox,
    // Compile-time failures produce no program output; that is a timeout
    // equivalent to callers (nothing to show), so keep stdout empty and carry
    // the reason in stderr instead.
    stdout,
    stderr,
  };
}
