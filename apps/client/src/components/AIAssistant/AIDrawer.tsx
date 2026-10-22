import React, { useState } from 'react';
import type { DemoPersona, FileNode } from '@devcollab/shared';

interface AIDrawerProps {
  projectId: string;
  activeFile: FileNode | null;
  persona: DemoPersona;
  onApplyCode: (code: string) => void;
  getCodeContent: () => string;
  onClose: () => void;
}

export const AIDrawer: React.FC<AIDrawerProps> = ({
  activeFile,
  persona,
  onApplyCode,
  getCodeContent,
  onClose,
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [suggestedCode, setSuggestedCode] = useState<string | null>(null);
  const [modelName, setModelName] = useState<string>('copilot');
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCompletion = async (action: 'explain' | 'fix' | 'test' | 'custom', customPrompt?: string) => {
    const code = getCodeContent();
    const promptText = customPrompt || prompt || `Perform ${action} on current file`;

    setLoading(true);
    setError(null);
    setApplied(false);

    try {
      const res = await fetch('/api/ai/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-persona-id': persona.id,
          'x-devcollab-persona': persona.id,
        },
        body: JSON.stringify({
          prompt: promptText,
          code: code || undefined,
          language: activeFile?.language || 'TYPESCRIPT',
          action,
        }),
      });

      const json = await res.json();
      if (res.ok && json.data) {
        setResponse(json.data.response);
        setSuggestedCode(json.data.suggestedCode || null);
        setModelName(json.data.model || 'copilot');
      } else {
        setError(json?.error?.message || `AI Request failed: HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error reaching AI assistant');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = () => {
    if (!suggestedCode) return;
    onApplyCode(suggestedCode);
    setApplied(true);
    setTimeout(() => setApplied(false), 3000);
  };

  return (
    <div
      style={{
        width: '380px',
        backgroundColor: '#0a0f1d',
        borderLeft: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
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
          backgroundColor: '#0f172a',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🤖</span>
          <span style={{ fontWeight: 700, fontSize: '13px' }}>AI Copilot</span>
          <span
            style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              backgroundColor: '#312e81',
              color: '#c7d2fe',
              fontWeight: 600,
            }}
          >
            {modelName}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: '16px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Quick Action Pills */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1e293b',
          backgroundColor: '#0c1322',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <button
          disabled={loading || !activeFile}
          onClick={() => requestCompletion('explain', 'Explain the purpose and logic of this file')}
          style={{
            padding: '5px 10px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '6px',
            color: '#e2e8f0',
            fontSize: '11px',
            fontWeight: 600,
            cursor: loading || !activeFile ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>💡</span> Explain
        </button>

        <button
          disabled={loading || !activeFile}
          onClick={() => requestCompletion('fix', 'Fix potential bugs, improve type safety, and refactor')}
          style={{
            padding: '5px 10px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '6px',
            color: '#e2e8f0',
            fontSize: '11px',
            fontWeight: 600,
            cursor: loading || !activeFile ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>🛠️</span> Refactor / Fix
        </button>

        <button
          disabled={loading || !activeFile}
          onClick={() => requestCompletion('test', 'Generate comprehensive automated unit tests for this code')}
          style={{
            padding: '5px 10px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '6px',
            color: '#e2e8f0',
            fontSize: '11px',
            fontWeight: 600,
            cursor: loading || !activeFile ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span>🧪</span> Write Tests
        </button>
      </div>

      {/* Response / Chat Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        {error && (
          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '12px',
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: '#94a3b8',
              fontSize: '12px',
              padding: '12px',
            }}
          >
            <span style={{ fontSize: '18px' }}>⏳</span>
            <span>AI Copilot is analyzing {activeFile?.path || 'code'}...</span>
          </div>
        )}

        {!loading && !response && !error && (
          <div
            style={{
              textAlign: 'center',
              color: '#64748b',
              fontSize: '12px',
              padding: '40px 16px',
            }}
          >
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>✨</div>
            <p style={{ margin: 0 }}>
              Select a quick action above or enter a prompt below to analyze or refactor code in real time.
            </p>
          </div>
        )}

        {response && (
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid #1f2937',
              borderRadius: '8px',
              padding: '14px',
              fontSize: '12px',
              lineHeight: '1.5',
              color: '#e2e8f0',
              whiteSpace: 'pre-wrap',
            }}
          >
            {response}
          </div>
        )}

        {/* Suggested Code Preview & Apply Button */}
        {suggestedCode && (
          <div
            style={{
              backgroundColor: '#030712',
              border: '1px solid #334155',
              borderRadius: '8px',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                backgroundColor: '#0f172a',
                borderBottom: '1px solid #1e293b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8' }}>
                Suggested Code ({activeFile?.language || 'TYPESCRIPT'})
              </span>
              <button
                onClick={handleApply}
                disabled={applied}
                style={{
                  padding: '4px 10px',
                  backgroundColor: applied ? '#059669' : '#4f46e5',
                  border: 'none',
                  borderRadius: '4px',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: applied ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {applied ? '✓ Applied!' : '⚡ Apply to Editor'}
              </button>
            </div>

            <pre
              style={{
                margin: 0,
                padding: '10px 12px',
                fontSize: '11px',
                fontFamily: 'monospace',
                overflowX: 'auto',
                maxHeight: '200px',
                color: '#38bdf8',
                backgroundColor: '#070b14',
              }}
            >
              <code>{suggestedCode}</code>
            </pre>

            <div
              style={{
                padding: '6px 12px',
                backgroundColor: '#0f172a',
                borderTop: '1px solid #1e293b',
                fontSize: '10px',
                color: '#64748b',
              }}
            >
              Changes are merged via CRDT transaction and undoable with Ctrl+Z.
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid #1e293b',
          backgroundColor: '#0f172a',
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!prompt.trim() || loading) return;
            requestCompletion('custom');
          }}
          style={{ display: 'flex', gap: '8px' }}
        >
          <input
            type="text"
            placeholder={activeFile ? `Ask about ${activeFile.path}...` : 'Ask copilot a question...'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 10px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: '#f8fafc',
              fontSize: '12px',
              outline: 'none',
            }}
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            style={{
              padding: '8px 12px',
              backgroundColor: '#6366f1',
              border: 'none',
              borderRadius: '6px',
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 600,
              cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
              opacity: loading || !prompt.trim() ? 0.6 : 1,
            }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};
