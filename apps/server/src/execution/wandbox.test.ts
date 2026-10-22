import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeViaWandbox, getWandboxCompiler } from './wandbox.js';

describe('Wandbox Cloud Execution Engine', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps supported languages to Wandbox compiler ids', () => {
    expect(getWandboxCompiler('PYTHON')).toBe('cpython-3.13.8');
    expect(getWandboxCompiler('JAVASCRIPT')).toBe('nodejs-20.17.0');
    expect(getWandboxCompiler('TYPESCRIPT')).toBe('typescript-5.6.2');
    expect(() => getWandboxCompiler('MARKDOWN' as any)).toThrow();
  });

  it('executes Python code via mocked Wandbox API and streams stdout', async () => {
    const stdoutChunks: string[] = [];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: '0',
        signal: '',
        compiler_output: '',
        compiler_error: '',
        program_output: 'Hello from Wandbox\n',
        program_error: '',
      }),
    } as any);

    const result = await executeViaWandbox({
      code: 'print("Hello from Wandbox")',
      language: 'PYTHON',
      onStdout: (chunk) => stdoutChunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('Hello from Wandbox');
    expect(stdoutChunks).toEqual(['Hello from Wandbox\n']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('treats a sandbox kill signal as a timeout', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: '137',
        signal: 'Killed',
        compiler_output: '',
        compiler_error: '',
        program_output: '',
        program_error: '',
      }),
    } as any);

    const result = await executeViaWandbox({ code: 'while True: pass', language: 'PYTHON' });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(137);
  });

  it('surfaces compile and program errors via stderr', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: '1',
        signal: '',
        compiler_output: '',
        compiler_error: 'SyntaxError: something broke',
        program_output: '',
        program_error: 'Traceback cleared here',
      }),
    } as any);

    const result = await executeViaWandbox({ code: 'def oops', language: 'PYTHON' });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('SyntaxError');
    expect(result.timedOut).toBe(false);
  });

  it('reports transport errors clearly', async () => {
    global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('ECONNRESET'), { name: 'TimeoutError' }));

    await expect(
      executeViaWandbox({ code: 'print(1)', language: 'PYTHON' }),
    ).rejects.toThrow('Wandbox API request failed');
  });
});
