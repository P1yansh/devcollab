import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Room, SAVE_DEBOUNCE_MS } from './room.js';

interface RoomFixture {
  published: Uint8Array[];
  saved: Uint8Array[];
}

function makeRoom(initial: Buffer | null, onExpire: () => void = () => undefined): { room: Room; fixture: RoomFixture } {
  const fixture: RoomFixture = { published: [], saved: [] };
  const room = new Room(
    'file-1',
    'proj-1',
    {
      async saveState(update) {
        fixture.saved.push(update);
      },
      publishUpdate(update) {
        fixture.published.push(update);
      },
      onExpire,
    },
    initial,
  );
  return { room, fixture };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Room', () => {
  it('materializes text from the persisted binary state', () => {
    const { room } = makeRoom(null);
    room.ydoc.transact(() => {
      room.ydoc.getText('monaco').insert(0, 'hello world');
    }, 'test');
    const binary = room.encodeState();

    const { room: reloaded } = makeRoom(Buffer.from(binary));
    expect(reloaded.getText()).toBe('hello world');
  });

  it('publishes every local mutation and debounces persistence', async () => {
    const { room, fixture } = makeRoom(null);
    room.ydoc.transact(() => {
      room.ydoc.getText('monaco').insert(0, 'abc');
    }, 'test-local');
    room.ydoc.transact(() => {
      room.ydoc.getText('monaco').insert(3, 'def');
    }, 'test-local');

    expect(fixture.published.length).toBe(2);
    expect(fixture.saved.length).toBe(0);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(fixture.saved.length).toBe(1);

    const savedBinary = fixture.saved[0];
    if (!savedBinary) throw new Error('save state missing');
    const { room: reloaded } = makeRoom(Buffer.from(savedBinary));
    expect(reloaded.getText()).toBe('abcdef');
  });

  it('suppresses publish/save for the initial load origin', async () => {
    const { room, fixture } = makeRoom(null);
    room.ydoc.transact(() => {
      room.ydoc.getText('monaco').insert(0, 'x');
    }, 'load');
    expect(fixture.published.length).toBe(0);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(fixture.saved.length).toBe(0);
    expect(room.getText()).toBe('x');
  });

  it('persists remote Redis updates without publishing them back', async () => {
    const { room, fixture } = makeRoom(null);
    const remote = new Y.Doc();
    remote.getText('monaco').insert(0, 'from another node');
    const update = Y.encodeStateAsUpdate(remote);

    room.applyRemoteUpdate(update, 'redis');
    expect(fixture.published.length).toBe(0);
    expect(fixture.saved.length).toBe(0);

    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(fixture.published.length).toBe(0);
    expect(fixture.saved.length).toBe(1);
    expect(room.getText()).toBe('from another node');
  });

  it('flush() persists immediately and destroy() expires through the manager', async () => {
    let expired = false;
    const { room, fixture } = makeRoom(null, () => {
      expired = true;
    });
    room.ydoc.transact(() => {
      room.ydoc.getText('monaco').insert(0, 'snapshot me');
    }, 'test-local');
    expect(fixture.saved.length).toBe(0);
    await room.flush();
    expect(fixture.saved.length).toBe(1);

    await room.destroy();
    expect(expired).toBe(true);
  });

  it('coalesces rapid edits into exactly one save', async () => {
    const { room, fixture } = makeRoom(null);
    for (let i = 0; i < 5; i++) {
      room.ydoc.transact(() => {
        room.ydoc.getText('monaco').insert(0, 'a');
      }, 'test-local');
      await vi.advanceTimersByTimeAsync(300);
    }
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50);
    expect(fixture.saved.length).toBe(1);
  });
});
