import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeViaJudge0, getJudge0LanguageId } from './judge0.js';

describe('Judge0 Cloud Execution Engine', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps supported languages to Judge0 language ids', () => {
    expect(getJudge0LanguageId('PYTHON')).toBe(71);
    expect(getJudge0LanguageId('JAVASCRIPT')).toBe(63);
    expect(() => getJudge0LanguageId('JAVESCRIPT' as any)).toThrow();
    expect(() => getJudge0LanguageId('MARKDOWN' as any)).toThrow();
  });

  it('executes Python code via mocked Judge0 API and streams stdout', async () => {
    const stdoutChunks: string[] = [];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: 'Hello from Judge0\n',
        stderr: null,
        compile_output: null,
        message: null,
        status: { id: 3, description: 'Accepted' },
      }),
    } as any);

    const result = await executeViaJudge0({
      code: 'print("Hello from Judge0")',
      language: 'PYTHON',
      onStdout: (chunk) => stdoutChunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('Hello from Judge0');
    expect(stdoutChunks).toEqual(['Hello from Judge0\n']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports sandbox-side time limit exceeded as a timeout', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: null,
        stderr: 'Time limit signal',
        compile_output: null,
        message: null,
        status: { id: 5, description: 'Time Limit Exceeded' },
      }),
    } as any);

    const result = await executeViaJudge0({
      code: 'while True: pass',
      language: 'PYTHON',
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('timed out');
  });

  it('reports compile/runtime errors via stderr path', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        stdout: null,
        stderr: null,
        compile_output: 'SyntaxError: something broke',
        message: null,
        status: { id: 11, description: 'Runtime Error (NZEC)' },
      }),
    } as any);

    const result = await executeViaJudge0({
      code: 'def oops',
      language: 'PYTHON',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SyntaxError');
    expect(result.timedOut).toBe(false);
  });
});
