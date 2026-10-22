# ⚡ DevCollab: Real-Time Collaborative Coding Platform

> Browser-based multiplayer code editor with CRDTs (Yjs), Monaco multi-cursor synchronization, isolated Docker code execution, and recoverable version history.

---

## 🚀 Quickstart for Windows & POSIX

### Prerequisites
- **Node.js**: v20 or higher
- **Docker Desktop**: Running in Linux containers mode (with Docker Compose V2)

### 1. Setup & Backing Services
Run the unified setup command (automatically runs `scripts/setup-sandboxes.ps1` on Windows or `scripts/setup-sandboxes.sh` on POSIX):

```bash
npm run setup
```

This verifies Docker connectivity, starts PostgreSQL 16 and Redis 7 via Docker Compose, and builds the hardened sandbox runner images:
- `devcollab-runner-node:latest` (unprivileged UID 10001, Node 20, Alpine)
- `devcollab-runner-python:latest` (unprivileged UID 10001, Python 3.12, Alpine)

### 2. Start DevCollab
```bash
npm run dev
```

Open **`http://localhost:5173`** in your browser.

---

## 👥 Seed Demo Personas & Testing Multiplayer

DevCollab comes pre-seeded with 3 personas in the top navigation bar so you can test multi-user collaboration immediately without manual signup:

| Persona | Role | Color | Capabilities |
| :--- | :--- | :--- | :--- |
| **Alice** | `OWNER` | `#6366f1` (Purple) | Full access: edit, execute code, file CRUD, take snapshots, rollback versions. |
| **Bob** | `EDITOR` | `#10b981` (Green) | Edit code, execute in sandbox, file CRUD, take snapshots, rollback versions. |
| **Charlie** | `VIEWER` | `#f59e0b` (Orange) | Read-only mode: cannot mutate files, cannot execute code, cannot rollback. |

> **Pro Tip**: Open two browser windows (or one normal and one incognito), select **Alice** in one and **Bob** in the other, and watch live cursors, text edits, and execution outputs synchronize in real time!

---

## 🏗️ Architecture & Dual-Channel Topology

```
                  ┌────────────────────────────────────────┐
                  │       Browser Client (React + Vite)    │
                  └───────────────┬────────────────┬───────┘
                                  │                │
            CRDT Sync Channel     │                │ Control & Execution Channel
      y-websocket on Port 4001    │                │ Socket.IO + REST on Port 4000
    /yjs/:projectId/:fileId       │                │ /socket.io + /api
                                  ▼                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      DevCollab Node.js Server                          │
│                                                                        │
│   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
│   │     Yjs RoomManager       │      │   Socket.IO Control Engine  │   │
│   │  - In-Memory Y.Doc Truth  │      │  - Project Roster & Presence│   │
│   │  - Awareness (Cursors)    │      │  - Chat Messages            │   │
│   │  - Scoped UndoManager     │      │  - File Tree CRUD           │   │
│   │  - Viewer Write Guard     │      │  - Snapshot & Rollback Ack  │   │
│   └─────────────┬─────────────┘      └──────────────┬──────────────┘   │
└─────────────────┼───────────────────────────────────┼──────────────────┘
                  │                                   │
      Pub/Sub     │                                   │ Dockerode
                  ▼                                   ▼
        ┌──────────────────┐               ┌────────────────────────┐
        │     Redis 7      │               │   Hardened Container   │
        │ - Doc Channel    │               │   Execution Sandbox    │
        │ - Socket Adapter │               │ (Network: none, 256MB) │
        └──────────────────┘               └────────────────────────┘
                  ▲
                  │ Prisma ORM
        ┌──────────────────┐
        │  PostgreSQL 16   │
        │ - Projects & RBAC│
        │ - CRDT Bytea     │
        │ - Version History│
        └──────────────────┘
```

---

## 🔒 Security & Sandboxing Guarantees

Executing arbitrary, untrusted user-submitted code is strictly isolated by DevCollab's defense-in-depth sandbox engine:

1. **Host Isolation**: User code **never** executes on the host machine.
2. **Network Isolation**: Containers run with `NetworkMode: 'none'` (no egress/ingress network access).
3. **Unprivileged Execution**: Runs as unprivileged UID/GID `10001:10001` (never `root`).
4. **Dropped Capabilities**: `CapDrop: ['ALL']` with `SecurityOpt: ['no-new-privileges']`.
5. **Read-Only Root Filesystem**: `ReadonlyRootfs: true`, mounting only a restricted 32MB tmpfs at `/tmp` (`noexec, nosuid`).
6. **Resource Quotas**: Hard memory limit of `256MB` (no swap expansion), CPU quota of `0.5` cores, and process limit `PidsLimit: 64` (preventing fork bombs).
7. **Timeout Kill Switch**: Containers exceeding `7000ms` are immediately killed with `SIGKILL` and forcefully removed.
8. **Real-Time Multiplexing**: Stdout and stderr chunks are demultiplexed and streamed live back to all project collaborators via WebSockets.

---

## 📦 Packaging & Release Distribution

To package DevCollab into `devcollab-release.zip` for release (including the pre-populated local `.env`):

```bash
npm run package
```

The release script runs full build and verification gates, stages repository files while excluding `node_modules` and cache artifacts, and produces `devcollab-release.zip`.

To run the full non-interactive test suite:
```bash
npm test
```
