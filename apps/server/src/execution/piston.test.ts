import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeViaPiston, getPistonLanguageConfig } from './piston.js';

describe('Piston Cloud Execution Engine', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('maps supported languages to Piston runtime versions', () => {
    expect(getPistonLanguageConfig('PYTHON')).toEqual({ language: 'python', version: '3.10.0' });
    expect(getPistonLanguageConfig('JAVASCRIPT')).toEqual({ language: 'javascript', version: '18.15.0' });
    expect(getPistonLanguageConfig('TYPESCRIPT')).toEqual({ language: 'typescript', version: '5.0.3' });
    expect(() => getPistonLanguageConfig('MARKDOWN' as any)).toThrow();
  });

  it('executes Python code via mocked Piston API and streams stdout', async () => {
    const stdoutChunks: string[] = [];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        language: 'python',
        version: '3.10.0',
        run: {
          stdout: 'Hello from Piston\n',
          stderr: '',
          code: 0,
          signal: null,
          output: 'Hello from Piston\n',
        },
      }),
    } as any);

    const result = await executeViaPiston({
      code: 'print("Hello from Piston")',
      language: 'PYTHON',
      onStdout: (chunk) => stdoutChunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('Hello from Piston');
    expect(stdoutChunks).toEqual(['Hello from Piston\n']);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles execution timeout gracefully', async () => {
    global.fetch = vi.fn().mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        // Trigger abort signal
        const timer = setTimeout(() => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }, 50);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const result = await executeViaPiston({
      code: 'while True: pass',
      language: 'PYTHON',
      timeoutMs: 30,
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(137);
    expect(result.stderr).toContain('timed out');
  });

  it('handles API errors with descriptive exceptions', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    } as any);

    await expect(
      executeViaPiston({
        code: 'console.log(1)',
        language: 'JAVASCRIPT',
      }),
    ).rejects.toThrow('Piston API returned error HTTP 503: Service Unavailable');
  });
});
