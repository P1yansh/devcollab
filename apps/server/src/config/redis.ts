import { Redis } from 'ioredis';

/**
 * Redis instances are created lazily and owned by their subsystem:
 * - `createDocPubSub()` - Yjs doc update relay (dedicated pub/sub pair)
 * - Socket.IO adapter pub/sub - created in index.ts bootstrap with its own
 *   pair so subscriber channels never collide.
 */

export interface RedisPair {
  publisher: Redis;
  subscriber: Redis;
}

export function createRedisPair(redisUrl: string): RedisPair {
  // lazyConnect: connections are opened explicitly in bootstrap/shutdown flow.
  const common = { maxRetriesPerRequest: null, lazyConnect: true } as const;
  const publisher = new Redis(redisUrl, common);
  const subscriber = new Redis(redisUrl, common);
  return { publisher, subscriber };
}

/** Keep a legacy alias for call sites created before the rename. */
export const createDocPubSub = createRedisPair;

/**
 * Fire-and-forget error loggers so Redis outages are loud, never silent.
 */
export function attachRedisErrorLogging(...clients: Redis[]): void {
  for (const client of clients) {
    client.on('error', (err: unknown) => {
      console.error('[redis] client error:', err);
    });
  }
}
