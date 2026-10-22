import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// npm workspaces run each package with the package dir as cwd, but a single
// .env lives at the monorepo root - walk upward until we find it.
function findRepoEnvFile(): string | undefined {
  let dir = process.cwd();
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

loadDotenv({ path: findRepoEnvFile() });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Control channel (Express + Socket.IO)
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_URL: z.string().min(1).default('http://localhost:5173'),

  // CRDT channel (dedicated ws server)
  YJS_WS_PORT: z.coerce.number().int().positive().default(4001),

  // Persistence / cache
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  // Sandboxed execution (used by the executor in a later phase)
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().positive().default(7000),
  EXECUTION_MEMORY_BYTES: z.coerce.number().int().positive().default(256 * 1024 * 1024),
  EXECUTION_CPU_QUOTA: z.coerce.number().int().positive().default(500_000_000),
  EXECUTION_PIDS_LIMIT: z.coerce.number().int().positive().default(64),
  DOCKER_SOCKET: z.string().min(1).optional(),
  EXECUTION_BACKEND: z.enum(['docker', 'piston', 'auto']).default('docker'),
  PISTON_API_URL: z.string().url().default('https://emkc.org/api/v2/piston/execute'),

  // AI Copilot
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gemini-1.5-flash'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    'Invalid environment configuration:\n' +
      parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'),
  );
  process.exit(1);
}

export const env = parsed.data;

/** Convenience switch for behavior that should only run outside production. */
export const isDev = env.NODE_ENV === 'development';
