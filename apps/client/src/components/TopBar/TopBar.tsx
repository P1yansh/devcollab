import React, { useState } from 'react';
import { type DemoPersona, DEMO_PERSONAS, type PeerPresence, type Role } from '@devcollab/shared';

interface TopBarProps {
  projectName: string;
  inviteCode: string;
  currentPersona: DemoPersona;
  currentRole: Role;
  onSwitchPersona: (persona: DemoPersona) => void;
  onRunCode: () => void;
  isRunning: boolean;
  activeDrawer: 'none' | 'chat' | 'history' | 'ai';
  onToggleDrawer: (drawer: 'chat' | 'history' | 'ai') => void;
  peers: PeerPresence[];
  onNavigateHome?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  projectName,
  inviteCode,
  currentPersona,
  currentRole,
  onSwitchPersona,
  onRunCode,
  isRunning,
  activeDrawer,
  onToggleDrawer,
  peers,
  onNavigateHome,
}) => {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const canExecute = currentRole === 'OWNER' || currentRole === 'EDITOR';
  const hasInviteCode = Boolean(inviteCode && inviteCode !== '...' && currentRole !== 'VIEWER');
  const inviteUrl = hasInviteCode ? `${window.location.origin}/join/${inviteCode}` : '';

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2500);
  };

  return (
    <header
      style={{
        height: '48px',
        backgroundColor: '#0f172a',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        userSelect: 'none',
        position: 'relative',
        zIndex: 50,
      }}
    >
      {/* Left: Branding & Project */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div
          onClick={onNavigateHome}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: onNavigateHome ? 'pointer' : 'default',
          }}
          title={onNavigateHome ? 'Return to Workspace Dashboard' : undefined}
        >
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              backgroundColor: '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '14px',
            }}
          >
            ⚡
          </div>
          <span style={{ fontWeight: 700, fontSize: '15px', color: '#f8fafc', letterSpacing: '-0.02em' }}>
            DevCollab
          </span>
        </div>

        {onNavigateHome && (
          <button
            onClick={onNavigateHome}
            style={{
              padding: '2px 8px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '4px',
              color: '#94a3b8',
              fontSize: '11px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
            title="Back to all projects"
          >
            ← Projects
          </button>
        )}

        <div style={{ height: '16px', width: '1px', backgroundColor: '#334155' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>{projectName}</span>
          {hasInviteCode && (
            <button
              onClick={() => setShowInviteModal(true)}
              style={{
                padding: '2px 8px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '4px',
                color: '#818cf8',
                fontSize: '11px',
                cursor: 'pointer',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
              title="Share project invite link"
            >
              <span>🔗</span>
              <span>Invite</span>
            </button>
          )}
        </div>
      </div>

      {/* Center: Run Code & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button
          onClick={onRunCode}
          disabled={!canExecute || isRunning}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 14px',
            backgroundColor: !canExecute ? '#334155' : isRunning ? '#d97706' : '#10b981',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: !canExecute || isRunning ? 'not-allowed' : 'pointer',
            opacity: !canExecute ? 0.6 : 1,
            transition: 'background-color 0.15s',
          }}
          title={!canExecute ? 'Viewers cannot execute code' : 'Execute code in sandbox (Ctrl+Enter)'}
        >
          {isRunning ? (
            <>
              <span className="animate-pulse-glow">⏳</span>
              <span>Running...</span>
            </>
          ) : (
            <>
              <span>▶</span>
              <span>Run Code</span>
            </>
          )}
        </button>
      </div>

      {/* Right: Peers, Persona Switcher & Drawers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {/* Active Peers Strip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {peers.map((peer) => (
            <div
              key={peer.clientId}
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                backgroundColor: peer.avatarColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                fontSize: '11px',
                fontWeight: 700,
                border: '2px solid #0f172a',
                boxShadow: '0 0 0 1px #334155',
              }}
              title={`${peer.username} (${peer.role}) ${peer.line ? `Line ${peer.line}` : ''}`}
            >
              {peer.username[0]}
            </div>
          ))}
        </div>

        <div style={{ height: '16px', width: '1px', backgroundColor: '#334155' }} />

        {/* Persona Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>AS:</span>
          <select
            value={currentPersona.id}
            onChange={(e) => {
              const target = DEMO_PERSONAS.find((p) => p.id === e.target.value);
              if (target) onSwitchPersona(target);
            }}
            style={{
              padding: '4px 8px',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '4px',
              color: '#f8fafc',
              fontSize: '12px',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {DEMO_PERSONAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.username} ({p.role})
              </option>
            ))}
          </select>
        </div>

        {/* Drawer Toggles */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => onToggleDrawer('ai')}
            style={{
              padding: '4px 10px',
              backgroundColor: activeDrawer === 'ai' ? '#4338ca' : '#1e293b',
              border: '1px solid #4f46e5',
              borderRadius: '4px',
              color: activeDrawer === 'ai' ? '#f8fafc' : '#c7d2fe',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
            title="Toggle AI Copilot"
          >
            🤖 AI Copilot
          </button>
          <button
            onClick={() => onToggleDrawer('history')}
            style={{
              padding: '4px 10px',
              backgroundColor: activeDrawer === 'history' ? '#334155' : '#1e293b',
              border: '1px solid #334155',
              borderRadius: '4px',
              color: activeDrawer === 'history' ? '#f8fafc' : '#94a3b8',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Toggle Version Snapshots"
          >
            🕒 History
          </button>
          <button
            onClick={() => onToggleDrawer('chat')}
            style={{
              padding: '4px 10px',
              backgroundColor: activeDrawer === 'chat' ? '#334155' : '#1e293b',
              border: '1px solid #334155',
              borderRadius: '4px',
              color: activeDrawer === 'chat' ? '#f8fafc' : '#94a3b8',
              fontSize: '12px',
              cursor: 'pointer',
            }}
            title="Toggle Project Chat"
          >
            💬 Chat
          </button>
        </div>
      </div>

      {/* Share / Invite Modal */}
      {showInviteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
          onClick={() => setShowInviteModal(false)}
        >
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '24px',
              width: '100%',
              maxWidth: '460px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
                Invite Collaborators
              </h3>
              <button
                onClick={() => setShowInviteModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>

            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 16px 0', lineHeight: 1.4 }}>
              Share this link with your teammates. When they open it, they will automatically join <strong>{projectName}</strong> as an Editor.
            </p>

            {/* Direct Join Link */}
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>
                Shareable Room Link
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={inviteUrl}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    backgroundColor: '#0a0f1d',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#38bdf8',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => copyToClipboard(inviteUrl)}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: copiedText === inviteUrl ? '#059669' : '#6366f1',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copiedText === inviteUrl ? '✓ Copied' : 'Copy Link'}
                </button>
              </div>
            </div>

            {/* Invite Code */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>
                Invite Code
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={inviteCode}
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    backgroundColor: '#0a0f1d',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => copyToClipboard(inviteCode)}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: copiedText === inviteCode ? '#059669' : '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copiedText === inviteCode ? '✓ Copied' : 'Copy Code'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowInviteModal(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#334155',
                  border: 'none',
                  borderRadius: '6px',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
