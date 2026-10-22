import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io, type Socket } from 'socket.io-client';
import {
  type DemoPersona,
  type FileNode,
  type Language,
  type PeerPresence,
  type Role,
  type SnapshotMeta,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@devcollab/shared';

import { TopBar } from '../TopBar/TopBar.js';
import { FileExplorer } from '../Sidebar/FileExplorer.js';
import { CollaborativeEditor, type EditorHandle } from '../Editor/CollaborativeEditor.js';
import { ExecutionDrawer } from '../Terminal/ExecutionDrawer.js';
import { ChatDrawer } from '../Chat/ChatDrawer.js';
import { HistoryDrawer } from '../History/HistoryDrawer.js';
import { AIDrawer } from '../AIAssistant/AIDrawer.js';
import type { ChatItem, ExecutionState, ProjectState } from '../../types.js';
import { usePersona } from '../../context/PersonaContext.js';

export const ProjectView: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { currentPersona, setCurrentPersona } = usePersona();

  const [project, setProject] = useState<ProjectState | null>(null);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerPresence[]>([]);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'chat' | 'history' | 'ai'>('none');
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [execution, setExecution] = useState<ExecutionState>({
    status: 'idle',
    executionId: null,
    output: '',
    exitCode: null,
    durationMs: null,
  });

  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const editorRef = useRef<EditorHandle | null>(null);

  // 1. Fetch project info & verify persona membership
  useEffect(() => {
    if (!projectId) {
      navigate('/', { replace: true });
      return;
    }

    let ignore = false;
    async function fetchProject() {
      try {
        setLoadError(null);
        const res = await fetch(`/api/projects/${projectId}`, {
          headers: {
            'x-persona-id': currentPersona.id,
            'x-devcollab-persona': currentPersona.id,
          },
        });

        if (res.ok) {
          const json = await res.json();
          if (!ignore && json.data) {
            setProject((prev) => ({
              id: json.data.id,
              name: json.data.name,
              inviteCode: json.data.inviteCode || '...',
              role: (json.data.role as Role) || currentPersona.role,
              files: prev?.files || [],
              members: prev?.members || [],
              snapshots: prev?.snapshots || [],
            }));
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          if (!ignore) {
            setLoadError(errData?.error?.message || `Project room unavailable (HTTP ${res.status})`);
          }
        }
      } catch (err) {
        if (!ignore) {
          setLoadError(err instanceof Error ? err.message : 'Network error loading project room');
        }
      }
    }

    fetchProject();
    return () => {
      ignore = true;
    };
  }, [projectId, currentPersona.id, navigate]);

  // 2. Manage Socket.IO control channel
  useEffect(() => {
    if (!projectId) return;

    if (socketRef.current) {
      socketRef.current.disconnect();
    }

    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
      auth: { personaId: currentPersona.id },
      query: { personaId: currentPersona.id },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('project:join', { projectId }, (ack) => {
        if (ack.ok) {
          setProject((prev) =>
            prev
              ? {
                  ...prev,
                  role: ack.data.role,
                  inviteCode: ack.data.inviteCode ?? prev.inviteCode,
                  files: ack.data.files,
                  members: ack.data.members,
                  snapshots: ack.data.snapshots,
                }
              : {
                  id: projectId,
                  name: 'Project Room',
                  inviteCode: ack.data.inviteCode || '...',
                  role: ack.data.role,
                  files: ack.data.files,
                  members: ack.data.members,
                  snapshots: ack.data.snapshots,
                },
          );
          setLoadError(null);

          if (ack.data.files.length > 0) {
            setActiveFileId((current) => current || ack.data.files[0].id);
          }
        } else {
          console.error('Join room rejected:', ack.error);
          setLoadError(`Unable to join project room: ${ack.error}`);
        }
      });
    });

    socket.on('presence:sync', (payload: { peers: PeerPresence[] }) => {
      setPeers(payload.peers);
    });

    socket.on('peer:joined', (payload: { peer: PeerPresence }) => {
      setPeers((prev) => [...prev.filter((p) => p.clientId !== payload.peer.clientId), payload.peer]);
    });

    socket.on('peer:left', (payload: { clientId: number }) => {
      setPeers((prev) => prev.filter((p) => p.clientId !== payload.clientId));
    });

    socket.on('presence:update', (payload: { peer: PeerPresence }) => {
      setPeers((prev) =>
        prev.map((p) => (p.clientId === payload.peer.clientId ? { ...p, ...payload.peer } : p)),
      );
    });

    socket.on('chat:message', (msg: ChatItem) => {
      setMessages((prev) => [...prev, msg]);
    });

    socket.on('file:created', (payload: { file: FileNode }) => {
      setProject((prev) => (prev ? { ...prev, files: [...prev.files, payload.file] } : null));
    });

    socket.on('file:renamed', (payload: { file: FileNode }) => {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              files: prev.files.map((f) => (f.id === payload.file.id ? payload.file : f)),
            }
          : null,
      );
    });

    socket.on('file:deleted', (payload: { file: FileNode }) => {
      setProject((prev) =>
        prev
          ? {
              ...prev,
              files: prev.files.filter((f) => f.id !== payload.file.id),
            }
          : null,
      );
      setActiveFileId((current) => (current === payload.file.id ? null : current));
    });

    socket.on('execution:started', (payload) => {
      setTerminalOpen(true);
      setExecution({
        status: 'running',
        executionId: payload.executionId,
        backend: payload.backend,
        output: `=== [Execution Started: ${payload.language}${payload.backend ? ` via ${payload.backend.toUpperCase()}` : ''}] ===\n`,
        exitCode: null,
        durationMs: null,
        startedBy: payload.startedBy,
      });
    });

    const matchesCurrentExecution = (
      prev: ExecutionState,
      executionId: string | null,
    ): boolean => !executionId || prev.executionId === executionId;

    socket.on('execution:stdout', (payload) => {
      setExecution((prev) =>
        matchesCurrentExecution(prev, payload.executionId)
          ? { ...prev, output: prev.output + payload.chunk }
          : prev,
      );
    });

    socket.on('execution:stderr', (payload) => {
      setExecution((prev) =>
        matchesCurrentExecution(prev, payload.executionId)
          ? { ...prev, output: prev.output + payload.chunk }
          : prev,
      );
    });

    socket.on('execution:exit', (payload) => {
      setExecution((prev) =>
        matchesCurrentExecution(prev, payload.executionId)
          ? {
              ...prev,
              status: payload.timedOut ? 'timedOut' : 'completed',
              // Correction to the pre-dispatch badge: dispatch may fall back
              // to a different backend than the one shown when the run started.
              backend: payload.backend ?? prev.backend,
              exitCode: payload.exitCode,
              durationMs: payload.durationMs,
              output:
                prev.output +
                `\n=== [Exited with code ${payload.exitCode} in ${payload.durationMs}ms${payload.timedOut ? ' (TIMED OUT - KILLED)' : ''}${payload.backend ? ` via ${payload.backend.toUpperCase()}` : ''}] ===\n`,
            }
          : prev,
      );
    });

    socket.on('execution:rejected', (payload) => {
      setTerminalOpen(true);
      setExecution((prev) =>
        matchesCurrentExecution(prev, payload.executionId)
          ? {
              ...prev,
              status: 'failed',
              errorMessage: payload.message,
              output: prev.output + `\n❌ Execution Rejected: ${payload.message} (${payload.reason})\n`,
            }
          : prev,
      );
    });

    socket.on('snapshot:created', (payload: { snapshot: SnapshotMeta }) => {
      setProject((prev) =>
        prev ? { ...prev, snapshots: [payload.snapshot, ...prev.snapshots] } : null,
      );
    });

    socket.on('snapshot:rollbackApplied', (payload) => {
      setExecution((prev) => ({
        ...prev,
        output: prev.output + `\n↺ Version rollback applied to ${payload.filePath} by ${payload.restoredBy}\n`,
      }));
    });

    return () => {
      socket.disconnect();
    };
  }, [projectId, currentPersona.id]);

  // Actions
  const handleRunCode = () => {
    if (!project?.id || !activeFileId || !socketRef.current) return;
    socketRef.current.emit('execution:run', {
      projectId: project.id,
      fileId: activeFileId,
    });
  };

  const handleSendMessage = (content: string) => {
    if (!project?.id || !socketRef.current) return;
    socketRef.current.emit('chat:send', {
      projectId: project.id,
      content,
    });
  };

  const handleCreateFile = async (path: string, language: Language, content?: string): Promise<boolean> => {
    if (!project?.id || !socketRef.current) return false;
    return new Promise((resolve) => {
      socketRef.current?.emit('file:create', { projectId: project.id, path, language, content }, (ack) => {
        if (ack.ok) {
          setActiveFileId(ack.data.id);
          resolve(true);
        } else {
          alert(`Failed to create file: ${ack.error}`);
          resolve(false);
        }
      });
    });
  };

  const handleRenameFile = async (fileId: string, path: string): Promise<boolean> => {
    if (!project?.id || !socketRef.current) return false;
    return new Promise((resolve) => {
      socketRef.current?.emit('file:rename', { projectId: project.id, fileId, path }, (ack) => {
        if (ack.ok) {
          resolve(true);
        } else {
          alert(`Failed to rename file: ${ack.error}`);
          resolve(false);
        }
      });
    });
  };

  const handleDeleteFile = async (fileId: string): Promise<boolean> => {
    if (!project?.id || !socketRef.current) return false;
    return new Promise((resolve) => {
      socketRef.current?.emit('file:delete', { projectId: project.id, fileId }, (ack) => {
        if (ack.ok) {
          resolve(true);
        } else {
          alert(`Failed to delete file: ${ack.error}`);
          resolve(false);
        }
      });
    });
  };

  const handleCreateSnapshot = async (fileId: string, label: string): Promise<boolean> => {
    if (!project?.id || !socketRef.current) return false;
    return new Promise((resolve) => {
      socketRef.current?.emit('snapshot:create', { projectId: project.id, fileId, label }, (ack) => {
        if (ack.ok) {
          resolve(true);
        } else {
          alert(`Failed to create snapshot: ${ack.error}`);
          resolve(false);
        }
      });
    });
  };

  const handleRollbackSnapshot = async (snapshotId: string): Promise<boolean> => {
    if (!project?.id || !socketRef.current) return false;
    return new Promise((resolve) => {
      socketRef.current?.emit('snapshot:rollback', { projectId: project.id, snapshotId }, (ack) => {
        if (ack.ok) {
          resolve(true);
        } else {
          alert(`Rollback failed: ${ack.error}`);
          resolve(false);
        }
      });
    });
  };

  const activeFile = project?.files.find((f) => f.id === activeFileId) || null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      {loadError && (
        <div
          style={{
            background: '#dc2626',
            color: '#ffffff',
            padding: '8px 16px',
            fontSize: '13px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontWeight: 500,
            zIndex: 1000,
          }}
        >
          <span>⚠️ {loadError}</span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => navigate('/')}
              style={{
                background: '#450a0a',
                border: 'none',
                color: '#ffffff',
                padding: '3px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              ← Back to Projects
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#991b1b',
                border: 'none',
                color: '#ffffff',
                padding: '3px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <TopBar
        projectName={project?.name || (loadError ? 'Error loading project' : 'Loading project...')}
        inviteCode={project?.inviteCode || '...'}
        currentPersona={currentPersona}
        currentRole={project?.role || currentPersona.role}
        onSwitchPersona={(p) => setCurrentPersona(p)}
        onRunCode={handleRunCode}
        isRunning={execution.status === 'running'}
        activeDrawer={activeDrawer}
        onToggleDrawer={(d) => setActiveDrawer((prev) => (prev === d ? 'none' : d))}
        peers={peers}
        onNavigateHome={() => navigate('/')}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* File Tree Sidebar */}
        <FileExplorer
          files={project?.files || []}
          activeFileId={activeFileId}
          role={project?.role || currentPersona.role}
          onSelectFile={(id) => setActiveFileId(id)}
          onCreateFile={handleCreateFile}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
        />

        {/* Center: Editor + Bottom Terminal */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            {project && activeFile ? (
              <CollaborativeEditor
                ref={editorRef}
                key={`${project.id}-${activeFile.id}-${currentPersona.id}`}
                projectId={project.id}
                fileId={activeFile.id}
                filePath={activeFile.path}
                language={activeFile.language}
                persona={currentPersona}
                role={project.role}
                onCursorChange={(line, column) => {
                  socketRef.current?.emit('presence:update', {
                    projectId: project.id,
                    fileId: activeFile.id,
                    line,
                    column,
                  });
                }}
                onRunShortcut={handleRunCode}
              />
            ) : (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#475569',
                }}
              >
                Select a file from the explorer to start collaborative editing
              </div>
            )}
          </div>

          {/* Bottom Execution Terminal */}
          <ExecutionDrawer
            execution={execution}
            onClear={() =>
              setExecution({
                status: 'idle',
                executionId: null,
                output: '',
                exitCode: null,
                durationMs: null,
              })
            }
            isOpen={terminalOpen}
            onToggle={() => setTerminalOpen((prev) => !prev)}
          />
        </div>

        {/* Right Drawer: AI Copilot */}
        {activeDrawer === 'ai' && (
          <AIDrawer
            projectId={project?.id || ''}
            activeFile={activeFile}
            persona={currentPersona}
            getCodeContent={() => editorRef.current?.getText() || ''}
            onApplyCode={(code) => editorRef.current?.applyCode(code)}
            onClose={() => setActiveDrawer('none')}
          />
        )}

        {/* Right Drawer: Chat */}
        {activeDrawer === 'chat' && (
          <ChatDrawer
            messages={messages}
            onSendMessage={handleSendMessage}
            onClose={() => setActiveDrawer('none')}
          />
        )}

        {/* Right Drawer: History */}
        {activeDrawer === 'history' && (
          <HistoryDrawer
            projectId={project?.id || null}
            personaId={currentPersona.id}
            activeFileId={activeFileId}
            activeFilePath={activeFile?.path || null}
            snapshots={project?.snapshots || []}
            role={project?.role || currentPersona.role}
            onCreateSnapshot={handleCreateSnapshot}
            onRollbackSnapshot={handleRollbackSnapshot}
            onClose={() => setActiveDrawer('none')}
          />
        )}
      </div>
    </div>
  );
};
