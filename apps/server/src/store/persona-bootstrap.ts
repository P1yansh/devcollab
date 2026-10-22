import { DEMO_PERSONAS } from '@devcollab/shared';
import { prisma } from '../config/prisma.js';

/**
 * Guarantees a `User` row exists for every demo persona.
 *
 * Identity is resolved in-memory by `services/personas.ts` (no DB access), but
 * many rows (`ProjectMember`, `Snapshot.createdBy`, `ChatMessage.senderId`)
 * carry foreign keys into the `User` table. A freshly deployed database that
 * has only run migrations (no interactive `db:seed`) would otherwise reject
 * every project-create / invite-join with a FK violation surfaced as
 * "Project creation failed".
 *
 * Idempotent: upserts only touch the three known persona ids, so it is safe
 * on both the seeded local DB and a production cloud database. New personas
 * can be added to `DEMO_PERSONAS` and are covered automatically.
 */
export async function ensurePersonaUsers(): Promise<void> {
  await prisma.$transaction(
    DEMO_PERSONAS.map((persona) =>
      prisma.user.upsert({
        where: { id: persona.id },
        update: { username: persona.username, avatarColor: persona.avatarColor },
        create: {
          id: persona.id,
          username: persona.username,
          email: `${persona.id}@devcollab.local`,
          avatarColor: persona.avatarColor,
        },
      }),
    ),
  );
}
