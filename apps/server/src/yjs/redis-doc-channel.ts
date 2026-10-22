import type { Redis } from 'ioredis';

const DOC_CHANNEL = 'devcollab:doc-updates';

interface PublishedUpdate {
  projectId: string;
  fileId: string;
  u: string; // base64 payload
}

type YjsUpdateHandler = (projectId: string, fileId: string, update: Uint8Array) => void;

export class RedisDocChannel {
  private handler: YjsUpdateHandler | null = null;
  private subscribed = false;

  constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
  ) {}

  async start(): Promise<void> {
    await this.subscriber.subscribe(DOC_CHANNEL);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const parsed = JSON.parse(message) as PublishedUpdate;
        if (typeof parsed.projectId !== 'string' || typeof parsed.fileId !== 'string') return;
        const update = Buffer.from(parsed.u, 'base64');
        this.handler?.(parsed.projectId, parsed.fileId, new Uint8Array(update));
      } catch (error: unknown) {
        console.error('[yjs-redis] failed to process published doc update:', error);
      }
    });
    this.subscribed = true;
  }

  publish(projectId: string, fileId: string, update: Uint8Array): void {
    if (!this.subscribed) return;
    const payload: PublishedUpdate = {
      projectId,
      fileId,
      u: Buffer.from(update).toString('base64'),
    };
    const channelPayload = JSON.stringify(payload);
    void this.publisher.publish(DOC_CHANNEL, channelPayload);
  }

  subscribe(handler: YjsUpdateHandler): void {
    this.handler = handler;
  }

  async stop(): Promise<void> {
    if (this.subscribed) {
      await this.subscriber.unsubscribe(DOC_CHANNEL);
      this.subscribed = false;
    }
    this.handler = null;
  }
}
