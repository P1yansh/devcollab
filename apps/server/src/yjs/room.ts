import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';

export const SAVE_DEBOUNCE_MS = 2000;

export interface RoomContext {
  /** Canonical persisted save (DB BYTEA). Debounced, not per keystroke. */
  saveState(update: Uint8Array): Promise<void>;
  /** Cross-node fan-out (Redis pub/sub). Called for every doc mutation. */
  publishUpdate(update: Uint8Array): void;
  /** Manager cleanup when the room goes away. */
  onExpire(): void;
}

/**
 * Live Y.Doc for one project file, with an awareness instance shared by all
 * of its connections. The room is authoritative while loaded; on idle expiry
 * the latest state is flushed to persistence.
 */
export class Room {
  readonly ydoc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;

  private saveTimer: NodeJS.Timeout | null = null;
  private expiring = false;
  private connections = new Set<unknown>(); // websocket conn wrappers, attached by transport layer

  constructor(
    readonly fileId: string,
    readonly projectId: string,
    private readonly ctx: RoomContext,
    initialState: Buffer | null,
  ) {
    this.awareness = new awarenessProtocol.Awareness(this.ydoc);
    if (initialState && initialState.byteLength > 0) {
      Y.applyUpdate(this.ydoc, initialState, 'load');
    }
    this.ydoc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;
      // Remote Redis updates still need to be persisted locally, but they
      // must not be published back to Redis. Re-publishing creates an echo
      // storm between nodes even though Yjs itself de-duplicates the state.
      if (origin !== 'redis') {
        this.ctx.publishUpdate(update);
      }
      this.scheduleSave();
    });
  }

  applyRemoteUpdate(update: Uint8Array, origin: unknown): void {
    if (this.expiring) return;
    Y.applyUpdate(this.ydoc, update, origin);
  }

  getText(): string {
    return this.ydoc.getText('monaco').toString();
  }

  encodeState(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  trackConnection(conn: unknown): void {
    this.connections.add(conn);
  }

  releaseConnection(conn: unknown): void {
    this.connections.delete(conn);
  }

  get isEmpty(): boolean {
    return this.connections.size === 0;
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.ctx.saveState(this.encodeState());
    }, SAVE_DEBOUNCE_MS);
  }

  /** Immediate flush used on room expiry / shutdown. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.ctx.saveState(this.encodeState());
  }

  async destroy(): Promise<void> {
    if (this.expiring) return;
    this.expiring = true;
    await this.flush();
    this.awareness.destroy();
    this.ydoc.destroy();
    this.ctx.onExpire();
  }
}
