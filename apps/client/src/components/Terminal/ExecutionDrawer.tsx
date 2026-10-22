import React from 'react';
import type { ExecutionState } from '../../types.js';

/** Honest label + color for whatever backend actually executed the code. */
function backendLabel(backend: string): string {
  switch (backend) {
    case 'piston':
      return 'PISTON (Cloud)';
    case 'judge0':
      return 'JUDGE0 (Cloud)';
    case 'wandbox':
      return 'WANDBOX (Cloud)';
    case 'auto':
      return 'CLOUD (Fallback)';
    default:
      return 'DOCKER (Isolated)';
  }
}

function backendShortLabel(backend: string): string {
  switch (backend) {
    case 'piston':
      return 'PISTON';
    case 'judge0':
      return 'JUDGE0';
    case 'wandbox':
      return 'WANDBOX';
    case 'auto':
      return 'AUTO';
    default:
      return 'DOCKER';
  }
}

const CLOUD_BACKENDS = new Set(['piston', 'judge0', 'wandbox', 'auto']);

interface ExecutionDrawerProps {
  execution: ExecutionState;
  onClear: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export const ExecutionDrawer: React.FC<ExecutionDrawerProps> = ({
  execution,
  onClear,
  isOpen,
  onToggle,
}) => {
  if (!isOpen) {
    return (
      <div
        onClick={onToggle}
        style={{
          height: '28px',
          backgroundColor: '#0f172a',
          borderTop: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          cursor: 'pointer',
          fontSize: '11px',
          color: '#94a3b8',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>💻 Terminal / Output</span>
          {execution.backend && (
            <span
              style={{
                padding: '1px 5px',
                borderRadius: '3px',
                backgroundColor: CLOUD_BACKENDS.has(execution.backend) ? '#0369a1' : '#334155',
                color: '#f8fafc',
                fontSize: '10px',
                fontWeight: 600,
              }}
            >
              {backendShortLabel(execution.backend)}
            </span>
          )}
          {execution.status === 'running' && (
            <span style={{ color: '#f59e0b', fontWeight: 600 }}>● Running...</span>
          )}
          {execution.status === 'completed' && (
            <span style={{ color: '#10b981' }}>● Exit {execution.exitCode}</span>
          )}
          {execution.status === 'timedOut' && (
            <span style={{ color: '#ef4444' }}>● Timed Out (7s limit)</span>
          )}
        </div>
        <span>▲ Expand</span>
      </div>
    );
  }

  const getStatusBadge = () => {
    switch (execution.status) {
      case 'running':
        return (
          <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#f59e0b', color: '#000', fontWeight: 700 }}>
            RUNNING
          </span>
        );
      case 'completed':
        return (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '4px',
              backgroundColor: execution.exitCode === 0 ? '#10b981' : '#ef4444',
              color: '#fff',
              fontWeight: 700,
            }}
          >
            EXIT {execution.exitCode} ({execution.durationMs}ms)
          </span>
        );
      case 'timedOut':
        return (
          <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#ef4444', color: '#fff', fontWeight: 700 }}>
            TIMED OUT (KILLED)
          </span>
        );
      case 'failed':
        return (
          <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: '#ef4444', color: '#fff', fontWeight: 700 }}>
            FAILED
          </span>
        );
      default:
        return <span style={{ color: '#64748b' }}>READY</span>;
    }
  };

  return (
    <div
      style={{
        height: '220px',
        backgroundColor: '#0a0f1d',
        borderTop: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Drawer Header */}
      <div
        style={{
          padding: '6px 16px',
          backgroundColor: '#0f172a',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontWeight: 600, color: '#f8fafc' }}>SANDBOX TERMINAL</span>
          {getStatusBadge()}
          {execution.backend && (
            <span
              style={{
                padding: '2px 8px',
                borderRadius: '4px',
                backgroundColor: CLOUD_BACKENDS.has(execution.backend) ? '#0369a1' : '#334155',
                color: '#f8fafc',
                fontSize: '11px',
                fontWeight: 700,
              }}
            >
              RUNNER: {backendLabel(execution.backend)}
            </span>
          )}
          {execution.startedBy && (
            <span style={{ color: '#94a3b8', fontSize: '11px' }}>
              Run by: <strong style={{ color: execution.startedBy.avatarColor }}>{execution.startedBy.username}</strong>
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={onClear}
            style={{
              padding: '2px 8px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '4px',
              color: '#94a3b8',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            Clear
          </button>
          <button
            onClick={onToggle}
            style={{
              padding: '2px 8px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '4px',
              color: '#94a3b8',
              fontSize: '11px',
              cursor: 'pointer',
            }}
          >
            ▼ Minimize
          </button>
        </div>
      </div>

      {/* Output Console */}
      <pre
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
          fontSize: '12px',
          lineHeight: '1.5',
          color: '#e2e8f0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          backgroundColor: '#020617',
        }}
      >
        {execution.output || (
          <span style={{ color: '#475569' }}>
            No output yet. Click 'Run Code' or press Ctrl+Enter to execute in an isolated Docker container.
          </span>
        )}
      </pre>
    </div>
  );
};
