# 🏛️ DevCollab Agent & Skill Guidelines (Athena Harness)

This document governs agent behavior, engineering standards, and workflow disciplines for **DevCollab** — a real-time collaborative coding platform featuring CRDTs, Monaco multi-cursor synchronization, sandboxed code execution, and recoverable version history.

---

## 1. Curated Agent Personas & Specializations

| Agent Persona | Focus Area | Operational Mandate |
| :--- | :--- | :--- |
| **`architect`** | System Design & Concurrency Strategy | Design the real-time CRDT sync pipeline, WebSocket event architecture, room scaling, and overall client-server synchronization model. |
| **`code-architect`** | Modular Feature Blueprints | Blueprint concrete component hierarchies, service boundaries, data schemas, and type-safe contracts before coding. |
| **`planner`** | Sprint & Milestone Planning | Break multi-phase implementation (CRDT sync, Monaco integration, Docker sandbox, version snapshots) into isolated deliverable units. |
| **`typescript-reviewer`** | Type Safety & Async Correctness | Enforce strict typing across WebSocket payloads, CRDT state updates, Monaco bindings, and database repositories. |
| **`react-reviewer`** | React 18/19 & Monaco Hygiene | Audit hook usage, prevent unnecessary re-renders, enforce clean Monaco model attachment/disposal, and manage client/server boundaries. |
| **`react-build-resolver`** | Bundler & Worker Diagnostics | Surgically resolve Vite, Monaco worker packaging (`editor.worker.js`), and TSX build errors. |
| **`build-error-resolver`** | Rapid Compilation Fixes | Fix TypeScript and compiler errors with minimal, targeted diffs to keep the build green. |
| **`database-reviewer`** | PostgreSQL Schema & Migration Safety | Design normalized relational schemas for users, projects, roles, comments, and binary CRDT update logs/snapshots. |
| **`security-reviewer`** | Sandbox Isolation & Auth Hardening | Audit the Docker code execution sandbox (resource limits, non-root, network isolation), verify RBAC permissions, and sanitize inputs. |
| **`performance-optimizer`** | Latency & Memory Profiling | Profile WebSocket throughput, Yjs document memory consumption, and Monaco DOM rendering performance. |
| **`silent-failure-hunter`** | Error Propagation & Resiliency | Ensure no unhandled Promise rejections in async socket handlers, and guarantee sandbox timeouts cleanly terminate. |
| **`type-design-analyzer`** | Invariant & State Safety | Enforce types that make illegal states impossible in CRDT documents, WebSocket events, and permission matrices. |
| **`e2e-runner`** | Multi-User Collaboration Testing | Run Playwright multi-browser journeys to verify live multi-cursor synchronization, concurrent editing, and code execution. |
| **`tdd-guide`** | Test-Driven Development | Enforce test-first methodology for CRDT convergence, REST endpoints, and role-based access control. |
| **`code-reviewer`** | General Code Quality | Maintain clean, idiomatic, and maintainable TypeScript/React/Node code. |
| **`code-simplifier`** | Refactoring & Clarity | Simplify complex state machines and concurrent event flows while preserving exact behavior. |
| **`docs-lookup`** | Library & API Context | Consult Monaco Editor, Yjs (`y-monaco`, `y-websocket`), Dockerode, and Socket.IO API patterns. |
| **`doc-updater`** | Architecture Codemaps | Keep project documentation, architecture diagrams, and codemaps up to date. |

---

## 2. Curated Skills & Technical Disciplines

### Real-Time Concurrency & Collaboration
* **`crdt-collaboration`**: Yjs document modeling (`Y.Doc`, `Y.Text`), `y-monaco` binding, awareness presence (cursors/colors), scoped `Y.UndoManager`, document compaction, and recoverable binary snapshots.
* **`latency-critical-systems`**: Sub-100ms real-time sync budgeting, WebSocket backpressure, tracking p95/p99 latency for cursor broadcasts.
* **`redis-patterns`**: Multi-server Socket.IO scaling via Redis adapter, ephemeral room presence caching, and pub/sub distribution.

### Sandboxed Execution & Security
* **`sandboxed-execution`**: Secure Docker container management via Dockerode, `--network=none`, `--read-only`, non-root runner (`uid 10001`), `--memory=256m`, `--pids-limit=64`, hard timeout kill switches, and streaming stdout/stderr back over WebSockets.
* **`docker-patterns`**: Hardened base images (Alpine/Distroless), multi-stage builds, and container lifecycle hygiene.
* **`security-review`**: RBAC validation, command injection prevention, sanitization of untrusted code inputs, and secret protection.

### Frontend & Monaco Editor
* **`react-patterns`**: React 18/19 patterns, state machines for collaboration states, Suspense, and resilient UI error boundaries.
* **`react-performance`**: Avoiding editor re-renders during high-frequency cursor awareness events, virtualized trees.
* **`vite-patterns`**: Monaco worker bundling, fast HMR, and WebSocket proxying during development.
* **`design-system`**: Unified IDE layout (file explorer, tab manager, Monaco editor pane, terminal/execution drawer, collaborator presence strip, chat sidebar).
* **`make-interfaces-feel-better`**: Fluid cursor transitions, smooth keyboard shortcuts (Ctrl+S, Ctrl+Enter to run code), responsive feel.

### Backend, Database & Quality
* **`backend-patterns`**: Express / Node.js clean architecture (controllers, services, repositories, middleware).
* **`api-design`**: RESTful API design for authentication, project management, invitations, and permissions.
* **`contract-first`**: Shared TypeScript types and contracts for WebSocket events and REST payloads.
* **`postgres-patterns` & `database-migrations` & `prisma-patterns`**: Relational persistence, JSONB/BYTEA storage for version snapshots, and zero-downtime migrations.
* **`e2e-testing` & `tdd-workflow` & `verification-loop`**: Multi-context Playwright testing (collaborator A + B), unit testing CRDT convergence, and 6-phase verification gates.

---

## 3. Core Architectural Invariants

1. **CRDT Single Source of Truth**:
   - The in-memory `Y.Doc` is the canonical state for active collaborative sessions.
   - Never call `editor.setValue()` directly in collaborative mode; always mutate through `Y.Text` transactions or `MonacoBinding`.
2. **User-Scoped Undo/Redo**:
   - `Y.UndoManager` MUST be scoped to the local editor origin to avoid undoing concurrent edits made by peers.
3. **Execution Sandboxing Security**:
   - User code must NEVER execute directly on the host machine.
   - Sandbox containers must strictly enforce `--network=none`, non-root user, memory limits, and process limits (`--pids-limit`).
   - Hard execution timeout (5-10s) must be enforced with automatic `SIGKILL` termination.
4. **Repository Boundary Isolation**:
   - All code, dependencies, and configuration for DevCollab must reside strictly within `projects/DEV_COLLAB`.
   - Never install subproject dependencies into Athena root.
5. **Multi-User Test Verification**:
   - Every real-time feature must be verified through automated tests or multi-browser Playwright simulations before release.
