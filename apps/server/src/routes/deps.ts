import type {
  FileStore,
  MembershipStore,
  ProjectStore,
  SnapshotStore,
} from '../store/types.js';
import type { SnapshotDocBridge } from '../yjs/room-manager.js';

/**
 * Everything the REST routers need, injected so integration tests can run
 * against in-memory fakes without a database or a live Yjs server.
 */
export interface RouteDeps {
  projects: ProjectStore;
  membership: MembershipStore;
  files: FileStore;
  snapshots: SnapshotStore;
  /** Subset of RoomManager (structurally satisfied by the real manager). */
  docs: SnapshotDocBridge;
}
