#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, '..');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('\x1b[36m==> Building @devcollab/shared contracts...\x1b[0m');
const buildShared = spawn(npmCmd, ['run', 'build', '--workspace=@devcollab/shared'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

buildShared.on('exit', (code) => {
  if (code !== 0) {
    console.error('\x1b[31mERROR: Failed to build @devcollab/shared\x1b[0m');
    process.exit(1);
  }

  console.log('\x1b[32m==> Starting DevCollab Server & Client...\x1b[0m');

  const serverProc = spawn(npmCmd, ['run', 'dev', '--workspace=@devcollab/server'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  const clientProc = spawn(npmCmd, ['run', 'dev', '--workspace=@devcollab/client'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  const cleanup = () => {
    try {
      serverProc.kill('SIGTERM');
      clientProc.kill('SIGTERM');
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  serverProc.on('exit', (c) => {
    if (c !== 0 && c !== null) {
      console.error(`\x1b[31m[SERVER] exited with code ${c}\x1b[0m`);
      cleanup();
    }
  });

  clientProc.on('exit', (c) => {
    if (c !== 0 && c !== null) {
      console.error(`\x1b[31m[CLIENT] exited with code ${c}\x1b[0m`);
      cleanup();
    }
  });
});
