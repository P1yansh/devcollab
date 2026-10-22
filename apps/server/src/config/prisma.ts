import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { __devcollabPrisma?: PrismaClient };

export const prisma = globalForPrisma.__devcollabPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__devcollabPrisma = prisma;
}
