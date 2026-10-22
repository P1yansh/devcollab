import { describe, expect, it } from 'vitest';
import { executeInSandbox } from './executor.js';

describe('Sandbox Execution Engine', () => {
  it('executes TypeScript code with type definitions and captures stdout', async () => {
    const code = `
      interface User { name: string; age: number; }
      const u: User = { name: "Alice", age: 30 };
      console.log("User:", u.name, u.age);
    `;
    const chunks: string[] = [];
    const result = await executeInSandbox({
      code,
      language: 'TYPESCRIPT',
      onStdout: (c) => chunks.push(c),
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('User: Alice 30');
    expect(chunks.join('')).toContain('User: Alice 30');
  });

  it('executes Python code and captures stdout', async () => {
    const code = `
def fib(n):
    return n if n <= 1 else fib(n-1) + fib(n-2)
print("FIB:", [fib(i) for i in range(7)])
`;
    const result = await executeInSandbox({
      code,
      language: 'PYTHON',
    });

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toContain('FIB: [0, 1, 1, 2, 3, 5, 8]');
  });

  it('enforces non-root unprivileged execution (UID 10001)', async () => {
    const code = `import os
print("UID:", os.getuid(), "GID:", os.getgid())`;
    const result = await executeInSandbox({
      code,
      language: 'PYTHON',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('UID: 10001 GID: 10001');
  });

  it('enforces execution timeout and terminates infinite loops', async () => {
    const code = `while(true) {}`;
    const result = await executeInSandbox({
      code,
      language: 'JAVASCRIPT',
      timeoutMs: 1500, // fast timeout for test
    });

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  }, 10000);
});
