import type { Language } from '@devcollab/shared';
import { env } from '../config/env.js';
import { MAX_OUTPUT_BYTES, type ExecuteOptions, type ExecuteResult } from './executor.js';

/**
 * Judge0 CE cloud execution backend (https://ce.judge0.com).
 *
 * The public Piston API went whitelist-only on 2026-02-15, so cloud/hosted
 * deploys without a Docker socket (Render) default to Judge0 instead. The
 * public CE endpoint is keyless; `wait=true` keeps the API request open until
 * the sandbox finishes, so the client-side AbortController doubles as the hard
 * timeout and the result arrives in one shot (output is streamed once).
 */

// Judge0 language ids (ce.judge0.com): 71 Python 3.x, 63 Node.js 18.x,
// 94 TypeScript (ts-node on the instance, availability varies).
const JUDGE0_LANGUAGE_IDS: Partial<Record<Language, number>> = {
  PYTHON: 71,
  JAVASCRIPT: 63,
  TYPESCRIPT: 94,
};

// Judge0 status ids: 5=Time Limit Exceeded, 6=Compilation Error,
// 7..12 runtime failures (11=NZEC), 13=Internal Error; 3=Accepted (clean run).
const JUDGE0_STATUS_TIME_LIMIT = 5;

// Judge0 CE compiles on shared infrastructure; give the HTTP round-trip head
// room beyond the execution timeout so the deadline is enforced on the run
// itself, not the transport.
const HTTP_BUFFER_MS = 5000;

interface Judge0Submission {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  status: { id: number; description: string };
}

export function getJudge0LanguageId(lang: Language): number {
  const id = JUDGE0_LANGUAGE_IDS[lang];
  if (!id) {
    throw new Error(`Unsupported execution language for Judge0: ${lang}`);
  }
  return id;
}

function clipOutput(text: string | null | undefined): string {
  if (!text) return '';
  return text.length > MAX_OUTPUT_BYTES ? text.slice(0, MAX_OUTPUT_BYTES) : text;
}

interface FetchOutcome {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

/**
 * Executes code via the public Judge0 CE sandbox. Enforces the execution
 * timeout through an AbortController on the long-poll `wait=true` request,
 * clips output to the shared 500 KB limit, and reports stderr reasons.
 */
export async function executeViaJudge0(options: ExecuteOptions): Promise<ExecuteResult> {
  const timeoutMs = options.timeoutMs ?? env.EXECUTION_TIMEOUT_MS ?? 7000;
  const languageId = getJudge0LanguageId(options.language);
  const startTime = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + HTTP_BUFFER_MS);

  let timedOut = false;
  let response: FetchOutcome | null = null;
  let transportError: string | null = null;
  try {
    const res = await fetch(env.JUDGE0_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_code: options.code,
        language_id: languageId,
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
    throw new Error(`Judge0 API request failed: ${transportError ?? 'no response'}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Judge0 API HTTP ${response.status}: ${detail}`);
  }

  const submission = (await response.json()) as Judge0Submission;
  const stdout = clipOutput(submission.stdout);
  const stderr = clipOutput(
    submission.message || submission.compile_output || submission.stderr,
  );
  const timedOutBySandbox = submission.status?.id === JUDGE0_STATUS_TIME_LIMIT;

  if (timedOutBySandbox) {
    options.onStdout?.(`Execution timed out (${submission.status?.description})`);
  } else if (stdout) {
    options.onStdout?.(stdout);
  }
  if (stderr) options.onStderr?.(stderr);

  return {
    // Fatal sandbox statuses report exit 1; anything else that finished
    // normally is a clean run.
    exitCode: timedOutBySandbox || (!submission.stdout && stderr) ? 1 : 0,
    durationMs,
    timedOut: timedOutBySandbox,
    stdout: timedOutBySandbox ? `Execution timed out (${submission.status?.description})` : stdout,
    stderr,
  };
}
