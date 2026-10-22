import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { MonacoBinding } from 'y-monaco';
import type * as monacoType from 'monaco-editor';
import type { DemoPersona, Language, Role } from '@devcollab/shared';

export interface EditorHandle {
  getText: () => string;
  applyCode: (code: string) => void;
}

interface CollaborativeEditorProps {
  projectId: string;
  fileId: string;
  filePath: string;
  language: Language;
  persona: DemoPersona;
  role: Role;
  onCursorChange?: (line: number, column: number) => void;
  onRunShortcut?: () => void;
}

function getMonacoLanguage(lang: Language): string {
  switch (lang) {
    case 'TYPESCRIPT':
      return 'typescript';
    case 'JAVASCRIPT':
      return 'javascript';
    case 'PYTHON':
      return 'python';
    case 'MARKDOWN':
      return 'markdown';
    default:
      return 'plaintext';
  }
}

export const CollaborativeEditor = React.forwardRef<EditorHandle, CollaborativeEditorProps>(
  function CollaborativeEditor(
    {
      projectId,
      fileId,
      filePath,
      language,
      persona,
      role,
      onCursorChange,
      onRunShortcut,
    },
    ref,
  ) {
    const [editor, setEditor] = useState<monacoType.editor.IStandaloneCodeEditor | null>(null);
    const monacoRef = useRef<typeof monacoType | null>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'offline'>('connecting');
    const bindingRef = useRef<MonacoBinding | null>(null);
    const providerRef = useRef<WebsocketProvider | null>(null);
    const ydocRef = useRef<Y.Doc | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        getText: () => {
          return ydocRef.current?.getText('monaco').toString() || editor?.getValue() || '';
        },
        applyCode: (code: string) => {
          const ydoc = ydocRef.current;
          if (!ydoc) return;
          const ytext = ydoc.getText('monaco');
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, code);
          }, 'ai-assistant-apply');
        },
      }),
      [editor],
    );

  const isReadOnly = role === 'VIEWER';

  const handleEditorDidMount: OnMount = (mountedEditor, monaco) => {
    setEditor(mountedEditor);
    monacoRef.current = monaco;

    // Ctrl+Enter or Cmd+Enter to execute code
    mountedEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onRunShortcut?.();
    });

    // Track cursor changes for presence broadcast
    mountedEditor.onDidChangeCursorPosition((e) => {
      onCursorChange?.(e.position.lineNumber, e.position.column);
    });
  };

  useEffect(() => {
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    // Clean up previous binding & provider if switching files
    if (bindingRef.current) {
      bindingRef.current.destroy();
      bindingRef.current = null;
    }
    if (providerRef.current) {
      providerRef.current.disconnect();
      providerRef.current.destroy();
      providerRef.current = null;
    }
    if (ydocRef.current) {
      ydocRef.current.destroy();
      ydocRef.current = null;
    }

    setStatus('connecting');

    // 1. Initialize Canonical Y.Doc
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const ytext = ydoc.getText('monaco');

    // 2. Establish y-websocket connection
    // When in production/Render or behind an HTTPS reverse proxy, route through wss://<host>/yjs
    // When running locally in dev (Vite port 5173), connect to ws://<host>:4001
    const isHttps = window.location.protocol === 'https:';
    const host = window.location.hostname || 'localhost';
    const isProductionOrSamePort = isHttps || window.location.port === '' || window.location.port === '4000';
    const wsUrl = isProductionOrSamePort ? `${isHttps ? 'wss:' : 'ws:'}//${window.location.host}` : `ws://${host}:4001`;
    const roomName = `yjs/${projectId}/${fileId}`;

    const provider = new WebsocketProvider(wsUrl, roomName, ydoc, {
      connect: true,
      // The server is the authority for document state and write permissions.
      // Cross-tab BroadcastChannel relay would bypass the server's RBAC gate.
      disableBc: true,
      params: { personaId: persona.id },
    });
    providerRef.current = provider;

    provider.on('status', (event: { status: 'connected' | 'connecting' | 'disconnected' }) => {
      setStatus(event.status === 'connected' ? 'connected' : 'connecting');
    });

    // 3. Set Awareness (Multi-Cursor & Live Presence)
    const awareness = provider.awareness;
    awareness.setLocalStateField('user', {
      name: persona.username,
      color: persona.avatarColor,
      id: persona.id,
      role,
    });

    // 4. Monaco Binding with Awareness
    // Enforce readOnly if role is VIEWER
    editor.updateOptions({
      readOnly: isReadOnly,
    });

    const binding = new MonacoBinding(
      ytext,
      model,
      new Set([editor]),
      awareness,
    );
    // MonacoBinding registers its own model-disposal handler, while the
    // effect cleanup also tears the binding down. Both paths can fire when
    // React unmounts the editor/model in the same tick; make destroy
    // idempotent so y-monaco does not remove its listeners twice.
    const originalDestroy = binding.destroy.bind(binding);
    let bindingDestroyed = false;
    binding.destroy = () => {
      if (bindingDestroyed) return;
      bindingDestroyed = true;
      originalDestroy();
    };
    bindingRef.current = binding;

    // 5. Invariant: Scoped UndoManager (Local Edits Only)
    const undoManager = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([binding, 'ai-assistant-apply']),
    });

    // Bind Monaco keybindings to scoped Y.UndoManager
    const monacoInstance = monacoRef.current;
    if (monacoInstance) {
      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyZ, () => {
        undoManager.undo();
      });
      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyMod.Shift | monacoInstance.KeyCode.KeyZ, () => {
        undoManager.redo();
      });
      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyY, () => {
        undoManager.redo();
      });
    }

    // Monaco model cleanup
    return () => {
      undoManager.destroy();
      binding.destroy();
      provider.disconnect();
      provider.destroy();
      ydoc.destroy();
    };
  }, [editor, projectId, fileId, persona, isReadOnly]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* File Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          backgroundColor: '#1e293b',
          borderBottom: '1px solid #334155',
          fontSize: '13px',
          fontWeight: 500,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ color: '#94a3b8' }}>📄</span>
          <span style={{ color: '#f8fafc' }}>{filePath}</span>
          <span
            style={{
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: '#334155',
              color: '#94a3b8',
            }}
          >
            {language}
          </span>
          {isReadOnly && (
            <span
              style={{
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(245, 158, 11, 0.2)',
                color: '#f59e0b',
                fontWeight: 600,
              }}
            >
              READ-ONLY
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: status === 'connected' ? '#10b981' : '#f59e0b',
              }}
            />
            <span>{status === 'connected' ? 'CRDT Synced' : 'Syncing...'}</span>
          </div>
        </div>
      </div>

      {/* Editor Body */}
      <div style={{ flex: 1, position: 'relative' }}>
        <Editor
          height="100%"
          language={getMonacoLanguage(language)}
          theme="vs-dark"
          options={{
            readOnly: isReadOnly,
            // Keep Monaco's hidden textarea in sync so native input events
            // are actually blocked for VIEWERs (readOnly alone only gates
            // editor commands).
            domReadOnly: true,
            fontSize: 14,
            lineHeight: 22,
            fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            automaticLayout: true,
            tabSize: 2,
          }}
          onMount={handleEditorDidMount}
        />
      </div>
    </div>
  );
});
