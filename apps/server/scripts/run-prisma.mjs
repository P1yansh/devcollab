import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dir, '../../../.env') });

const args = process.argv.slice(2);
const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';
const res = spawnSync(npxCmd, ['prisma', ...args], { stdio: 'inherit', env: process.env });
process.exit(res.status ?? 0);
