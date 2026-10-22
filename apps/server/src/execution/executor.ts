import { PassThrough } from 'node:stream';
import Docker from 'dockerode';
import ts from 'typescript';
import type { Language } from '@devcollab/shared';
import { env } from '../config/env.js';

export interface ExecuteOptions {
  code: string;
  language: Language;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  timeoutMs?: number;
}

export interface ExecuteResult {
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export const MAX_OUTPUT_BYTES = 500 * 1024; // 500 KB limit
export const MAX_CONCURRENT_EXECUTIONS = 3;

let runningExecutions = 0;

const isWin = process.platform === 'win32';
export const docker = isWin
  ? new Docker({ socketPath: '//./pipe/docker_engine' })
  : new Docker({ socketPath: env.DOCKER_SOCKET || '/var/run/docker.sock' });

/**
 * Transpiles TypeScript into JavaScript so the Alpine Node runner
 * executes it without requiring external TypeScript compilers inside the container.
 */
export function transpileTypeScript(code: string): string {
  const result = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      removeComments: false,
    },
  });
  return result.outputText;
}

/**
 * Executes untrusted code inside an isolated ephemeral Docker container.
 * Strictly adheres to the Athena DevCollab sandbox security invariants:
 * - NetworkMode: none
 * - ReadonlyRootfs: true
 * - CapDrop: ALL
 * - no-new-privileges
 * - 256MB RAM (no swap)
 * - 0.5 CPU quota
 * - PidsLimit: 64 (anti-fork-bomb)
 * - Tmpfs /tmp 32m noexec
 * - User 10001:10001
 * - Hard timeout kill switch (7000ms default) with SIGKILL and forced container removal.
 */
export async function executeInSandbox(options: ExecuteOptions): Promise<ExecuteResult> {
  if (runningExecutions >= MAX_CONCURRENT_EXECUTIONS) {
    const err = new Error('Sandbox is busy: maximum concurrent executions reached');
    (err as any).code = 'BUSY';
    throw err;
  }

  const timeoutMs = options.timeoutMs ?? env.EXECUTION_TIMEOUT_MS ?? 7000;
  const startTime = Date.now();

  let image: string;
  let cmd: string[];

  if (options.language === 'PYTHON') {
    image = 'devcollab-runner-python:latest';
    cmd = ['python3', '-c', options.code];
  } else if (options.language === 'TYPESCRIPT' || options.language === 'JAVASCRIPT') {
    image = 'devcollab-runner-node:latest';
    const jsCode = options.language === 'TYPESCRIPT' ? transpileTypeScript(options.code) : options.code;
    cmd = ['node', '-e', jsCode];
  } else {
    throw new Error(`Unsupported execution language: ${options.language}`);
  }

  // Count only after language validation and transpilation succeed, so an
  // unsupported language or a transpiler failure cannot consume a slot.
  runningExecutions++;

  let container: Docker.Container;
  try {
    container = await docker.createContainer({
      Image: image,
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      OpenStdin: false,
      WorkingDir: '/home/sandbox',
      User: '10001:10001',
      HostConfig: {
        NetworkMode: 'none',
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        Memory: env.EXECUTION_MEMORY_BYTES || 256 * 1024 * 1024,
        MemorySwap: env.EXECUTION_MEMORY_BYTES || 256 * 1024 * 1024,
        NanoCpus: env.EXECUTION_CPU_QUOTA || 500_000_000,
        PidsLimit: env.EXECUTION_PIDS_LIMIT || 64,
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=32m',
        },
      },
    });
  } catch (err: unknown) {
    // If customized runner image is missing, attempt fallback image
    const fallbackImage = options.language === 'PYTHON' ? 'python:3.12-alpine' : 'node:20-alpine';
    try {
      container = await docker.createContainer({
        Image: fallbackImage,
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
        Tty: false,
        OpenStdin: false,
        WorkingDir: '/home/sandbox',
        User: '10001:10001',
        HostConfig: {
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          CapDrop: ['ALL'],
          SecurityOpt: ['no-new-privileges'],
          Memory: env.EXECUTION_MEMORY_BYTES || 256 * 1024 * 1024,
          MemorySwap: env.EXECUTION_MEMORY_BYTES || 256 * 1024 * 1024,
          NanoCpus: env.EXECUTION_CPU_QUOTA || 500_000_000,
          PidsLimit: env.EXECUTION_PIDS_LIMIT || 64,
          Tmpfs: {
            '/tmp': 'rw,noexec,nosuid,size=32m',
          },
        },
      });
    } catch (fallbackError: unknown) {
      runningExecutions = Math.max(0, runningExecutions - 1);
      throw fallbackError;
    }
  }

  let timedOut = false;
  let outputTruncated = false;
  let stdoutCollected = '';
  let stderrCollected = '';

  try {
    const rawStream = await container.attach({
      stream: true,
      stdout: true,
      stderr: true,
    });

    const stdoutPass = new PassThrough();
    const stderrPass = new PassThrough();

    stdoutPass.on('data', (chunk: Buffer) => {
      if (outputTruncated) return;
      const text = chunk.toString('utf-8');
      if (stdoutCollected.length + stderrCollected.length + text.length > MAX_OUTPUT_BYTES) {
        outputTruncated = true;
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - (stdoutCollected.length + stderrCollected.length));
        const partial = text.slice(0, remaining) + '\n[DevCollab Sandbox: output truncated at 500KB limit]\n';
        stdoutCollected += partial;
        options.onStdout?.(partial);
        void container.kill({ signal: 'SIGKILL' }).catch(() => {});
        return;
      }
      stdoutCollected += text;
      options.onStdout?.(text);
    });

    stderrPass.on('data', (chunk: Buffer) => {
      if (outputTruncated) return;
      const text = chunk.toString('utf-8');
      if (stdoutCollected.length + stderrCollected.length + text.length > MAX_OUTPUT_BYTES) {
        outputTruncated = true;
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - (stdoutCollected.length + stderrCollected.length));
        const partial = text.slice(0, remaining) + '\n[DevCollab Sandbox: output truncated at 500KB limit]\n';
        stderrCollected += partial;
        options.onStderr?.(partial);
        void container.kill({ signal: 'SIGKILL' }).catch(() => {});
        return;
      }
      stderrCollected += text;
      options.onStderr?.(text);
    });

    docker.modem.demuxStream(rawStream, stdoutPass, stderrPass);

    await container.start();

    // Hard timeout kill switch
    let timer: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<{ StatusCode: number }>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        void container
          .kill({ signal: 'SIGKILL' })
          .catch(() => {})
          .then(() => resolve({ StatusCode: 124 }));
      }, timeoutMs);
    });

    const waitPromise = container.wait();
    const result = await Promise.race([waitPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    // Wait briefly for trailing buffer flushes
    await new Promise((r) => setTimeout(r, 50));

    return {
      exitCode: timedOut ? 124 : result.StatusCode,
      durationMs: Date.now() - startTime,
      timedOut,
      stdout: stdoutCollected,
      stderr: stderrCollected,
    };
  } finally {
    runningExecutions = Math.max(0, runningExecutions - 1);
    try {
      await container.remove({ force: true });
    } catch {
      // Ignored: container already gone or cleaned up
    }
  }
}
