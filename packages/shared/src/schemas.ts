import { z } from 'zod';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();
export const roleSchema = z.enum(['OWNER', 'EDITOR', 'VIEWER']);
export const languageSchema = z.enum(['JAVASCRIPT', 'TYPESCRIPT', 'PYTHON', 'MARKDOWN']);

export const personaIdSchema = z.enum(['persona-alice', 'persona-bob', 'persona-charlie']);

/**
 * POSIX-style project-relative path. Rejects absolute paths, backslash
 * separators and traversal segments so the server never has to reason about
 * Windows-style input.
 */
export const projectPathSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\w.-]+(\/[\w.-]+)*$/, 'Path must be POSIX-style, relative, without traversal segments');

// ---------------------------------------------------------------------------
// REST payloads
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const joinProjectSchema = z.object({
  inviteCode: z.string().min(8).max(40).regex(/^[A-Za-z0-9_-]+$/),
});

export const updateMemberRoleSchema = z.object({
  userId: uuidSchema,
  role: roleSchema,
});

export const createFileSchema = z.object({
  projectId: uuidSchema,
  path: projectPathSchema,
  language: languageSchema,
  content: z.string().max(500_000).optional(),
});

export const renameFileSchema = z.object({
  projectId: uuidSchema,
  fileId: uuidSchema,
  path: projectPathSchema,
});

export const deleteFileSchema = z.object({
  projectId: uuidSchema,
  fileId: uuidSchema,
});

export const createSnapshotSchema = z.object({
  projectId: uuidSchema,
  fileId: uuidSchema,
  label: z.string().min(1).max(120),
});

export const rollbackProjectSchema = z.object({
  projectId: uuidSchema,
  snapshotId: uuidSchema,
});

export const aiActionSchema = z.enum(['explain', 'fix', 'test', 'custom']);
export type AIAction = z.infer<typeof aiActionSchema>;

export const aiCompletionSchema = z.object({
  prompt: z.string().min(1).max(20000),
  code: z.string().max(200_000).optional(),
  language: languageSchema.optional(),
  context: z.string().max(10_000).optional(),
  action: aiActionSchema.default('custom'),
});
export type AICompletionRequest = z.infer<typeof aiCompletionSchema>;

// ---------------------------------------------------------------------------
// Socket payloads
// ---------------------------------------------------------------------------

export const joinRoomSchema = z.object({
  projectId: uuidSchema,
});

export const presenceUpdateSchema = z.object({
  projectId: uuidSchema,
  fileId: uuidSchema.nullable(),
  line: z.number().int().min(0).nullable(),
  column: z.number().int().min(0).nullable(),
});

export const chatSendSchema = z.object({
  projectId: uuidSchema,
  content: z.string().min(1).max(2000),
});

export const executionRunSchema = z.object({
  projectId: uuidSchema,
  fileId: uuidSchema,
});

// ---------------------------------------------------------------------------
// Typed parse helpers
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function parseOr<T>(schema: z.ZodType<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
