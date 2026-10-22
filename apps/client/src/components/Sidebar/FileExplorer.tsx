import React, { useRef, useState } from 'react';
import type { FileNode, Language, Role } from '@devcollab/shared';

interface FileExplorerProps {
  files: FileNode[];
  activeFileId: string | null;
  role: Role;
  onSelectFile: (fileId: string) => void;
  onCreateFile: (path: string, language: Language, content?: string) => Promise<boolean>;
  onRenameFile: (fileId: string, newPath: string) => Promise<boolean>;
  onDeleteFile: (fileId: string) => Promise<boolean>;
}

function detectLanguage(path: string): Language {
  const lower = path.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'TYPESCRIPT';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'JAVASCRIPT';
  if (lower.endsWith('.py')) return 'PYTHON';
  return 'MARKDOWN';
}

export const FileExplorer: React.FC<FileExplorerProps> = ({
  files,
  activeFileId,
  role,
  onSelectFile,
  onCreateFile,
  onRenameFile,
  onDeleteFile,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [newLang, setNewLang] = useState<Language>('TYPESCRIPT');

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamePath, setRenamePath] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const canEdit = role === 'OWNER' || role === 'EDITOR';

  const processFiles = async (fileList: FileList | File[]) => {
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (file.size > 500 * 1024) {
        alert(`File "${file.name}" exceeds the 500KB limit.`);
        continue;
      }
      try {
        const content = await file.text();
        const lang = detectLanguage(file.name);
        await onCreateFile(file.name, lang, content);
      } catch {
        alert(`Failed to read file: ${file.name}`);
      }
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) return;
    const ok = await onCreateFile(newPath.trim(), newLang);
    if (ok) {
      setNewPath('');
      setIsCreating(false);
    }
  };

  const handleRename = async (e: React.FormEvent, fileId: string) => {
    e.preventDefault();
    if (!renamePath.trim()) return;
    const ok = await onRenameFile(fileId, renamePath.trim());
    if (ok) {
      setRenamingId(null);
    }
  };

  const getFileIcon = (lang: Language) => {
    switch (lang) {
      case 'TYPESCRIPT':
        return <span style={{ color: '#38bdf8' }}>TS</span>;
      case 'JAVASCRIPT':
        return <span style={{ color: '#facc15' }}>JS</span>;
      case 'PYTHON':
        return <span style={{ color: '#34d399' }}>PY</span>;
      case 'MARKDOWN':
        return <span style={{ color: '#a78bfa' }}>MD</span>;
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setIsDragging(false);
      }}
      onDrop={async (e) => {
        if (!canEdit) return;
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          await processFiles(e.dataTransfer.files);
        }
      }}
      style={{
        width: '240px',
        height: '100%',
        backgroundColor: '#0f172a',
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileInputChange}
        multiple
        style={{ display: 'none' }}
      />

      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(99, 102, 241, 0.25)',
            border: '2px dashed #6366f1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#a5b4fc',
            fontWeight: 600,
            fontSize: '13px',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          Drop files to upload
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em', color: '#64748b' }}>
          EXPLORER
        </span>
        {canEdit && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '0 2px',
                lineHeight: 1,
              }}
              title="Upload file(s)"
            >
              ↑
            </button>
            <button
              onClick={() => setIsCreating(true)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
                padding: '0 2px',
                lineHeight: 1,
              }}
              title="Create new file"
            >
              +
            </button>
          </div>
        )}
      </div>

      {/* New File Modal Input */}
      {isCreating && (
        <form
          onSubmit={handleCreate}
          style={{
            padding: '8px',
            backgroundColor: '#1e293b',
            borderBottom: '1px solid #334155',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          <input
            type="text"
            placeholder="filename.ts"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            autoFocus
            style={{
              padding: '4px 8px',
              backgroundColor: '#0f172a',
              border: '1px solid #475569',
              color: '#f8fafc',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '4px' }}>
            <select
              value={newLang}
              onChange={(e) => setNewLang(e.target.value as Language)}
              style={{
                padding: '4px',
                backgroundColor: '#0f172a',
                border: '1px solid #475569',
                color: '#f8fafc',
                borderRadius: '4px',
                fontSize: '11px',
                flex: 1,
              }}
            >
              <option value="TYPESCRIPT">TypeScript</option>
              <option value="JAVASCRIPT">JavaScript</option>
              <option value="PYTHON">Python</option>
              <option value="MARKDOWN">Markdown</option>
            </select>
            <button
              type="submit"
              style={{
                padding: '4px 8px',
                backgroundColor: '#6366f1',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              style={{
                padding: '4px 8px',
                backgroundColor: '#334155',
                color: '#94a3b8',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </form>
      )}

      {/* File List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {files.map((file) => {
          const isActive = file.id === activeFileId;
          const isRenaming = file.id === renamingId;

          if (isRenaming) {
            return (
              <form
                key={file.id}
                onSubmit={(e) => handleRename(e, file.id)}
                style={{ padding: '4px 8px', display: 'flex', gap: '4px' }}
              >
                <input
                  type="text"
                  value={renamePath}
                  onChange={(e) => setRenamePath(e.target.value)}
                  autoFocus
                  style={{
                    flex: 1,
                    padding: '2px 6px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #6366f1',
                    color: '#fff',
                    borderRadius: '4px',
                    fontSize: '12px',
                  }}
                />
                <button
                  type="submit"
                  style={{
                    padding: '2px 6px',
                    backgroundColor: '#6366f1',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingId(null)}
                  style={{
                    padding: '2px 6px',
                    backgroundColor: '#334155',
                    color: '#aaa',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </form>
            );
          }

          return (
            <div
              key={file.id}
              onClick={() => onSelectFile(file.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 14px',
                cursor: 'pointer',
                backgroundColor: isActive ? '#1e293b' : 'transparent',
                borderLeft: isActive ? '3px solid #6366f1' : '3px solid transparent',
                fontSize: '13px',
                color: isActive ? '#f8fafc' : '#94a3b8',
                transition: 'background-color 0.1s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold' }}>{getFileIcon(file.language)}</span>
                <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {file.path}
                </span>
              </div>

              {canEdit && (
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(file.id);
                      setRenamePath(file.path);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      fontSize: '11px',
                    }}
                    title="Rename"
                  >
                    ✎
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete ${file.path}?`)) {
                        onDeleteFile(file.id);
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ef4444',
                      cursor: 'pointer',
                      fontSize: '11px',
                    }}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
