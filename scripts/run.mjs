#!/usr/bin/env node
// Cross-platform script dispatcher.
//
// npm run setup   -> node scripts/run.mjs setup-sandboxes
// npm run package -> node scripts/run.mjs package-zip
//
// On Windows it invokes scripts/<target>.ps1 via PowerShell; on POSIX it
// invokes scripts/<target>.sh via bash. Recipients only ever run
// `npm run setup` / `npm run package` and never touch shell flags.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const [target] = process.argv.slice(2);

if (!target) {
  console.error('Usage: node scripts/run.mjs <script-name>');
  process.exit(1);
}

const isWin = process.platform === 'win32';
let command;
let args;

if (isWin) {
  command = 'powershell.exe';
  args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(scriptDir, `${target}.ps1`),
  ];
} else {
  command = 'bash';
  args = [path.join(scriptDir, `${target}.sh`)];
}

const result = spawnSync(command, args, { stdio: 'inherit' });

if (result.error) {
  console.error(
    isWin ? 'PowerShell is not available on this machine.' : 'bash is not available on this machine.',
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
