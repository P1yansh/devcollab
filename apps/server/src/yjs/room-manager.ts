import { Room } from './room.js';
import type { DocStateStore } from '../store/types.js';

export interface RoomPublishChannel {
  publish(projectId: string, fileId: string, update: Uint8Array): void;
  subscribe(handler: (projectId: string, fileId: string, update: Uint8Array) => void): void;
}

export interface SnapshotDocBridge {
  isRoomOpen(projectId: string, fileId: string): boolean;
  getText(projectId: string, fileId: string): Promise<string>;
  getBinaryState(projectId: string, fileId: string): Promise<Uint8Array>;
  /** Non-destructive rollback: replaces the text inside a live transaction. */
  applyRollback(projectId: string, fileId: string, targetText: string): Promise<void>;
  /** Destroys an open room (e.g. after file deletion). */
  destroyRoom(projectId: string, fileId: string): Promise<void>;
}

export class RoomNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoomNotFoundError';
  }
}

/**
 * Owns all live rooms in this process. The Yjs ws server, REST routes, and
 * Socket.IO handlers all read/write document state through this single
 * manager so there is exactly one shared Y.Doc per file per process.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  private inFlight = new Map<string, Promise<Room>>();
  private teardowns = new Map<string, Promise<void>>();

  constructor(
    private readonly docState: DocStateStore,
    private readonly publishChannel: RoomPublishChannel,
  ) {
    // Cross-node updates arriving over Redis are applied to the local doc
    // with the 'redis' origin. They still fan out to local websocket clients
    // and are persisted, but Room skips republishing them to Redis.
    void this.publishChannel;
    this.publishChannel.subscribe(this.handleRemoteUpdate.bind(this));
  }

  private roomKey(projectId: string, fileId: string): string {
    return `${projectId}/${fileId}`;
  }

  private handleRemoteUpdate(projectId: string, fileId: string, update: Uint8Array): void {
    const room = this.rooms.get(this.roomKey(projectId, fileId));
    if (room) room.applyRemoteUpdate(update, 'redis');
  }

  async getRoom(projectId: string, fileId: string): Promise<Room> {
    const key = this.roomKey(projectId, fileId);

    // Never hand out a room while its final flush is still in progress: the
    // old Y.Doc is about to be destroyed and a later load must see the
    // persisted state rather than a half-expired room.
    const teardown = this.teardowns.get(key);
    if (teardown) await teardown;

    const existing = this.rooms.get(key);
    if (existing) return existing;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const row = await this.docState.load(fileId);
        if (!row || row.projectId !== projectId) {
          throw new RoomNotFoundError(`File ${fileId} does not exist in project ${projectId}`);
        }

        const manager = this;
        let room: Room;
        room = new Room(
          fileId,
          projectId,
          {
            async saveState(update: Uint8Array) {
              await manager.docState.save(fileId, Buffer.from(update));
            },
            publishUpdate(update: Uint8Array) {
              manager.publishChannel.publish(projectId, fileId, update);
            },
            onExpire() {
              if (manager.rooms.get(key) === room) {
                manager.rooms.delete(key);
              }
            },
          },
          row.state,
        );
        this.rooms.set(key, room);
        return room;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  hasRoom(projectId: string, fileId: string): boolean {
    return this.rooms.has(this.roomKey(projectId, fileId));
  }

  /** Destroy rooms with no connected peers (called periodically + on demand). */
  async expireIdle(): Promise<void> {
    for (const [, room] of [...this.rooms.entries()]) {
      if (room.isEmpty) await this.destroyRoomInstance(room);
    }
  }

  async destroyRoom(projectId: string, fileId: string): Promise<void> {
    const key = this.roomKey(projectId, fileId);
    const room = this.rooms.get(key);
    if (room) {
      await this.destroyRoomInstance(room);
      return;
    }
    const teardown = this.teardowns.get(key);
    if (teardown) await teardown;
  }

  /**
   * Destroy a specific room and keep a teardown promise so getRoom() waits
   * for the final persistence flush before loading a replacement.
   */
  destroyRoomInstance(room: Room): Promise<void> {
    const key = this.roomKey(room.projectId, room.fileId);
    const existing = this.teardowns.get(key);
    if (existing) return existing;

    const teardown = room
      .destroy()
      .finally(() => {
        if (this.teardowns.get(key) === teardown) {
          this.teardowns.delete(key);
        }
        if (this.rooms.get(key) === room) {
          this.rooms.delete(key);
        }
      });
    this.teardowns.set(key, teardown);
    return teardown;
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.rooms.values()].map((room) => room.flush()));
  }

  // ---------------------------------------------------------------- SnapshotDocBridge

  isRoomOpen(projectId: string, fileId: string): boolean {
    return this.hasRoom(projectId, fileId);
  }

  async getBinaryState(projectId: string, fileId: string): Promise<Uint8Array> {
    const room = await this.getRoom(projectId, fileId);
    return room.encodeState();
  }

  async getText(projectId: string, fileId: string): Promise<string> {
    const room = await this.getRoom(projectId, fileId);
    return room.getText();
  }

  async applyRollback(projectId: string, fileId: string, targetText: string): Promise<void> {
    const room = await this.getRoom(projectId, fileId);
    // Single CRDT transaction, tagged origin. Never recreate the Y.Doc and
    // never bypass Y.Text - the transaction is broadcast through the normal
    // update pipeline so every connected editor converges.
    room.ydoc.transact(() => {
      const ytext = room.ydoc.getText('monaco');
      ytext.delete(0, ytext.length);
      ytext.insert(0, targetText);
    }, 'snapshot-rollback');
  }
}
