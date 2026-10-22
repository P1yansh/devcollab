import http from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { storeErrorHandler, registerRouters } from './routes/index.js';
import { createPrismaStores } from './store/index.js';
import { ensurePersonaUsers } from './store/persona-bootstrap.js';
import { createDocPubSub, attachRedisErrorLogging } from './config/redis.js';
import { env, isDev } from './config/env.js';
import { prisma } from './config/prisma.js';
import { RedisDocChannel } from './yjs/redis-doc-channel.js';
import { RoomManager } from './yjs/room-manager.js';
import { createYjsServer } from './yjs/yjs-server.js';
import { createControlChannel, attachRedisAdapter } from './socket/control-channel.js';
import { registerSocketHandlers } from './socket/handlers.js';

let shuttingDown = false;

export async function bootstrapServer(): Promise<void> {
  const stores = createPrismaStores();

  // Persona identity is in-memory, but storage tables carry FKs into `User`.
  // Ensure persona rows exist before any request hits a membership write.
  await ensurePersonaUsers();

  // ------------------------------------------------------------------ Redis
  const { publisher, subscriber } = createDocPubSub(env.REDIS_URL);
  attachRedisErrorLogging(publisher, subscriber);
  await Promise.all([publisher.connect(), subscriber.connect()]);

  const docChannel = new RedisDocChannel(publisher, subscriber);
  await docChannel.start();

  // ------------------------------------------------------------------ Yjs live doc engine
  const roomManager = new RoomManager(stores.docState, docChannel);

  // ------------------------------------------------------------------ Express / REST
  const app = express();
  app.use(cors({ origin: env.CLIENT_URL, credentials: true }));
  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, channel: 'rest', uptime: process.uptime() });
  });

  registerRouters(app, {
    projects: stores.projects,
    membership: stores.membership,
    files: stores.files,
    snapshots: stores.snapshots,
    docs: roomManager,
  });

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const clientDistCandidates = [
    resolve(process.cwd(), 'apps/client/dist'),
    resolve(process.cwd(), '../client/dist'),
    resolve(process.cwd(), 'dist/client'),
    resolve(currentDir, '../../client/dist'),
    resolve(currentDir, '../../../apps/client/dist'),
  ];
  const clientDist = clientDistCandidates.find((c) => existsSync(join(c, 'index.html')));

  if (clientDist) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/health') || req.path.startsWith('/socket.io')) {
        return next();
      }
      res.sendFile(join(clientDist, 'index.html'));
    });
  } else if (isDev) {
    app.use(express.static('public'));
  }

  // Typed store errors -> HTTP, everything else -> 500 without leaking internals.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const translated = storeErrorHandler(error);
    if (translated) {
      res.status(translated.status).json(translated.body);
      return;
    }
    console.error('[server] unhandled route error:', error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal server error' } });
    next();
  });

  const httpServer = http.createServer(app);

  // ------------------------------------------------------------------ Socket.IO control channel
  const io = createControlChannel(httpServer);
  const { publisher: adapterPub, subscriber: adapterSub } = createDocPubSub(env.REDIS_URL);
  attachRedisErrorLogging(adapterPub, adapterSub);
  await attachRedisAdapter(io, adapterPub, adapterSub);
  registerSocketHandlers(io, stores, roomManager);

  const adapterPub2: typeof adapterPub | null = adapterPub; // keep lifecycle references alive
  void adapterPub2;

  const isSinglePort = env.PORT === env.YJS_WS_PORT || process.env.SINGLE_PORT === 'true';

  // ------------------------------------------------------------------ Yjs CRDT channel
  const yjsChannelServer = isSinglePort
    ? createYjsServer({
        server: httpServer,
        rooms: roomManager,
        membership: stores.membership,
      })
    : createYjsServer({
        wsPort: env.YJS_WS_PORT,
        rooms: roomManager,
        membership: stores.membership,
      });

  // Idle room GC: every 2 minutes destroy rooms with no connected peers.
  const roomGcInterval = setInterval(() => {
    void roomManager.expireIdle().catch((error: unknown) => {
      console.error('[yjs] room GC failed:', error);
    });
  }, 120_000);
  roomGcInterval.unref();

  // ------------------------------------------------------------------ listeners
  if (isSinglePort) {
    await listen(httpServer, env.PORT);
    console.log(`[server] Unified single-port listening on ${env.PORT} (REST + Socket.IO + Yjs CRDT)`);
  } else {
    await Promise.all([
      listen(httpServer, env.PORT),
      listen(yjsChannelServer, env.YJS_WS_PORT),
    ]);
    console.log(`[server] REST + Socket.IO listening on ${env.PORT}`);
    console.log(`[server] Yjs CRDT channel  listening on ${env.YJS_WS_PORT} (/yjs/:projectId/:fileId)`);
  }

  // ------------------------------------------------------------------ graceful shutdown
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received - shutting down`);
    clearInterval(roomGcInterval);
    void (async () => {
      try {
        await roomManager.flushAll();
        await docChannel.stop();
        await io.close();
        httpServer.close();
        if (!isSinglePort) {
          yjsChannelServer.close();
        }
        await Promise.allSettled([
          publisher.quit(),
          subscriber.quit(),
          adapterPub.quit(),
          adapterSub.quit(),
        ]);
        await prisma.$disconnect();
      } catch (error: unknown) {
        console.error('[server] shutdown error:', error);
      } finally {
        process.exit(0);
      }
    })();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ------------------------------------------------------------------ process safety nets
process.on('unhandledRejection', (reason) => {
  console.error('[server] unhandledRejection:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('[server] uncaughtException:', error);
  // keep process alive deliberately: sandboxed demo tolerance; may be replaced by restart policy
});

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => resolve());
  });
}
bootstrapServer().catch((err: unknown) => {
  console.error('[server] Fatal bootstrap error:', err);
  process.exit(1);
});
