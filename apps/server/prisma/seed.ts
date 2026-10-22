import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import * as Y from 'yjs';
import { PrismaClient } from '@prisma/client';
import { DEMO_PERSONAS } from '@devcollab/shared';

const dir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(dir, '../../../.env') });
dotenv.config();

const prisma = new PrismaClient();

type StarterLanguage = 'TYPESCRIPT' | 'PYTHON' | 'MARKDOWN';

type StarterFile = { path: string; language: StarterLanguage; content: string };

const STARTER_FILES: StarterFile[] = [
  {
    path: 'index.ts',
    language: 'TYPESCRIPT',
    content: `// DevCollab demo file - edit me together with your peers!
// Press Ctrl+Enter (or the Run button) to execute this in a sandboxed container.

interface Persona {
  name: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
}

const personas: Persona[] = [
  { name: 'Alice', role: 'OWNER' },
  { name: 'Bob', role: 'EDITOR' },
  { name: 'Charlie', role: 'VIEWER' },
];

console.log('Hello from a sandboxed DevCollab container!');

personas.forEach((p) => {
  console.log(\`- \${p.name} joins as \${p.role}\`);
});
`,
  },
  {
    path: 'algorithm.py',
    language: 'PYTHON',
    content: `# DevCollab demo Python file - edit collaboratively!

def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


if __name__ == "__main__":
    print("Python runs isolated in Docker:", [fib(i) for i in range(10)])
`,
  },
  {
    path: 'README.md',
    language: 'MARKDOWN',
    content: `# DevCollab Demo Project

Welcome to your collaborative workspace!

- Alice is the **OWNER**
- Bob is an **EDITOR**
- Charlie is a **VIEWER** (read-only)

Open two browser windows, pick different personas in the top bar, and edit
together. Snapshots let you capture versions; rollbacks apply without
destroying the live collaborative state.
`,
  },
];

const DEMO_INVITE_CODE = 'devcollab-demo-0321';
export const DEMO_INVITE = DEMO_INVITE_CODE; // imported by config/docs checks if needed

function encodeStarterDoc(content: string): Buffer {
  const doc = new Y.Doc();
  const ytext = doc.getText('monaco');
  ytext.insert(0, content);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return Buffer.from(update);
}

async function main(): Promise<void> {
  const personaIds = DEMO_PERSONAS.map((p) => p.id);

  for (const persona of DEMO_PERSONAS) {
    await prisma.user.upsert({
      where: { id: persona.id },
      update: { username: persona.username, avatarColor: persona.avatarColor },
      create: {
        id: persona.id,
        username: persona.username,
        email: `${persona.id}@devcollab.local`,
        avatarColor: persona.avatarColor,
      },
    });
  }

  const project = await prisma.project.upsert({
    where: { inviteCode: DEMO_INVITE_CODE },
    update: {
      name: 'DevCollab Demo',
      description: 'Starter workspace for testing live collaboration and RBAC.',
    },
    create: {
      name: 'DevCollab Demo',
      description: 'Starter workspace for testing live collaboration and RBAC.',
      inviteCode: DEMO_INVITE_CODE,
    },
  });

  // Seed memberships idempotently
  for (const persona of DEMO_PERSONAS) {
    await prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: persona.id,
        },
      },
      update: { role: persona.role },
      create: {
        projectId: project.id,
        userId: persona.id,
        role: persona.role,
      },
    });
  }

  // Seed starter files with valid CRDT state idempotently
  for (const file of STARTER_FILES) {
    const yjsState = encodeStarterDoc(file.content);
    await prisma.projectFile.upsert({
      where: {
        projectId_path: {
          projectId: project.id,
          path: file.path,
        },
      },
      update: {
        language: file.language,
        yjsState,
      },
      create: {
        projectId: project.id,
        path: file.path,
        language: file.language,
        yjsState,
      },
    });
  }

  const fileCount = await prisma.projectFile.count({ where: { projectId: project.id } });
  console.log(`Seeded demo project ${project.id} with ${fileCount} files.`);
  console.log(`Seeded personas: ${personaIds.join(', ')}`);
}

main()
  .catch((err: unknown) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
