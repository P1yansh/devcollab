import React, { useState } from 'react';
import type { Role, SnapshotMeta } from '@devcollab/shared';

interface HistoryDrawerProps {
  projectId: string | null;
  personaId: string;
  activeFileId: string | null;
  activeFilePath: string | null;
  snapshots: SnapshotMeta[];
  role: Role;
  onCreateSnapshot: (fileId: string, label: string) => Promise<boolean>;
  onRollbackSnapshot: (snapshotId: string) => Promise<boolean>;
  onClose: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  projectId,
  personaId,
  activeFileId,
  activeFilePath,
  snapshots,
  role,
  onCreateSnapshot,
  onRollbackSnapshot,
  onClose,
}) => {
  const [label, setLabel] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [inspectingText, setInspectingText] = useState<string | null>(null);

  const canRollback = role === 'OWNER' || role === 'EDITOR';

  const fileSnapshots = activeFileId ? snapshots.filter((s) => s.fileId === activeFileId) : [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFileId || !label.trim()) return;
    const ok = await onCreateSnapshot(activeFileId, label.trim());
    if (ok) {
      setLabel('');
      setIsCreating(false);
    }
  };

  const handleInspect = async (snapshotId: string) => {
    if (!projectId || !activeFileId) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/files/${activeFileId}/snapshots/${snapshotId}`, {
        headers: {
          'x-persona-id': personaId,
        },
      });
      if (res.ok) {
        const json = await res.json();
        setInspectingText(json.data.readableText);
      }
    } catch {
      alert('Failed to load snapshot content');
    }
  };

  return (
    <div
      style={{
        width: '320px',
        height: '100%',
        backgroundColor: '#0f172a',
        borderLeft: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
          SNAPSHOTS ({activeFilePath || 'No file'})
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '14px' }}
        >
          ✕
        </button>
      </div>

      {/* Action Bar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b' }}>
        {canRollback && (
          <button
            onClick={() => setIsCreating(true)}
            disabled={!activeFileId}
            style={{
              width: '100%',
              padding: '6px',
              backgroundColor: '#6366f1',
              color: '#ffffff',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: !activeFileId ? 'not-allowed' : 'pointer',
              opacity: !activeFileId ? 0.6 : 1,
            }}
          >
            📸 Capture Version Snapshot
          </button>
        )}
      </div>

      {/* Create Dialog */}
      {isCreating && (
        <form onSubmit={handleCreate} style={{ padding: '10px 16px', backgroundColor: '#1e293b', borderBottom: '1px solid #334155' }}>
          <input
            type="text"
            placeholder="Snapshot label (e.g. Added algorithm)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
            style={{
              width: '100%',
              padding: '6px 8px',
              backgroundColor: '#0f172a',
              border: '1px solid #475569',
              borderRadius: '4px',
              color: '#fff',
              fontSize: '12px',
              marginBottom: '8px',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
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
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '4px 10px',
                backgroundColor: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Save
            </button>
          </div>
        </form>
      )}

      {/* Snapshot Preview Modal */}
      {inspectingText !== null && (
        <div style={{ padding: '10px 16px', backgroundColor: '#020617', borderBottom: '1px solid #334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>PREVIEW VERSION</span>
            <button
              onClick={() => setInspectingText(null)}
              style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '12px' }}
            >
              Close
            </button>
          </div>
          <pre
            style={{
              maxHeight: '120px',
              overflowY: 'auto',
              fontSize: '11px',
              color: '#cbd5e1',
              whiteSpace: 'pre-wrap',
            }}
          >
            {inspectingText}
          </pre>
        </div>
      )}

      {/* Snapshot List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
        {fileSnapshots.length === 0 ? (
          <div style={{ color: '#475569', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
            No snapshots for this file yet.
          </div>
        ) : (
          fileSnapshots.map((snap) => (
            <div
              key={snap.id}
              style={{
                padding: '10px',
                backgroundColor: '#1e293b',
                borderRadius: '6px',
                marginBottom: '8px',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>{snap.label}</span>
                <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                  {new Date(snap.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Created by: <span style={{ color: '#cbd5e1' }}>{snap.createdByName}</span>
              </div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                <button
                  onClick={() => handleInspect(snap.id)}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    backgroundColor: '#334155',
                    color: '#e2e8f0',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '11px',
                    cursor: 'pointer',
                  }}
                >
                  👁 Preview
                </button>
                {canRollback && (
                  <button
                    onClick={() => {
                      if (confirm(`Restore version "${snap.label}" into active editor?`)) {
                        onRollbackSnapshot(snap.id);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '4px 6px',
                      backgroundColor: '#f59e0b',
                      color: '#000',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ↺ Rollback
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
