import { Prisma } from '@prisma/client';
import { StoreError, type StoreErrorCode } from './types.js';

const PRISMA_CODE_TO_KIND: Record<'P2002' | 'P2025' | 'P2003', StoreErrorCode> = {
  P2002: 'conflict',
  P2025: 'not-found',
  P2003: 'not-found',
};

/**
 * Wrap a store operation so expected Prisma failures surface as typed
 * StoreError instances. Unexpected errors propagate untouched.
 */
export async function runStore<T>(operation: () => Promise<T>, conflictMessage: string): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const kind = PRISMA_CODE_TO_KIND[error.code as keyof typeof PRISMA_CODE_TO_KIND];
      if (kind) throw new StoreError(kind, conflictMessage, error);
    }
    throw error;
  }
}
