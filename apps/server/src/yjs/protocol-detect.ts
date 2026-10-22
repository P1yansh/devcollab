import * as decoding from 'lib0/decoding';

/** y-websocket top-level message types. */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;

/** sync sub message types. */
export const SYNC_TYPE_STEP_1 = 0; // {type1: ss1: request state vector}
export const SYNC_TYPE_STEP_2 = 1; // {type2: full state answer}
export const SYNC_TYPE_UPDATE = 2; // {type0: incremental update}

export type ClassifiedMessage =
  | { kind: 'awareness' }
  | { kind: 'sync'; mutating: boolean }
  | { kind: 'invalid' };

/**
 * Classifies a raw y-websocket frame without mutating downstream decoders.
 * `mutating` is true for messages that want to modify the document
 * (delayed update / sync step 2). Awareness and sync-step-1 requests are
 * always treated as read-safe.
 */
export function classifyIncomingMessage(data: Uint8Array): ClassifiedMessage {
  try {
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_AWARENESS) return { kind: 'awareness' };
    if (messageType !== MESSAGE_SYNC) return { kind: 'invalid' };
    const syncType = decoding.readVarUint(decoder);
    if (syncType === SYNC_TYPE_STEP_2 || syncType === SYNC_TYPE_UPDATE) {
      return { kind: 'sync', mutating: true };
    }
    if (syncType === SYNC_TYPE_STEP_1) return { kind: 'sync', mutating: false };
    return { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

/** Pure predicate used at the connection gate: can this persona type mutate text? */
export function canPersonaWrite(role: string | null): boolean {
  return role === 'OWNER' || role === 'EDITOR';
}
