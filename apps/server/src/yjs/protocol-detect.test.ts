import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as encoding from 'lib0/encoding';
import { classifyIncomingMessage, canPersonaWrite } from './protocol-detect.js';

function syncFrame(syncType: 0 | 1 | 2): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
  encoding.writeVarUint(enc, syncType);
  return encoding.toUint8Array(enc);
}

function awarenessFrame(): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 1); // MESSAGE_AWARENESS
  return encoding.toUint8Array(enc);
}

describe('classifyIncomingMessage', () => {
  it('treats sync step 1 (state-vector request) as non-mutating', () => {
    expect(classifyIncomingMessage(syncFrame(0))).toEqual({ kind: 'sync', mutating: false });
  });

  it('marks sync step 2 replies as mutating', () => {
    expect(classifyIncomingMessage(syncFrame(1))).toEqual({ kind: 'sync', mutating: true });
  });

  it('marks incremental updates as mutating', () => {
    expect(classifyIncomingMessage(syncFrame(2))).toEqual({ kind: 'sync', mutating: true });
  });

  it('treats awareness as read-safe', () => {
    expect(classifyIncomingMessage(awarenessFrame())).toEqual({ kind: 'awareness' });
  });

  it('flags garbage buffers as invalid instead of throwing', () => {
    expect(classifyIncomingMessage(new Uint8Array([0xff, 0xff, 0xff, 0x83, 0x17]))).toEqual({ kind: 'invalid' });
  });

  it('has a shared write gate consistent with the permission matrix', () => {
    expect(canPersonaWrite('VIEWER')).toBe(false);
    expect(canPersonaWrite('EDITOR')).toBe(true);
    expect(canPersonaWrite('OWNER')).toBe(true);
    expect(canPersonaWrite(null)).toBe(false);
  });
});
