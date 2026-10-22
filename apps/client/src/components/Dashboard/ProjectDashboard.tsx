import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ProjectSummary, type Role, DEMO_PERSONAS } from '@devcollab/shared';
import { usePersona } from '../../context/PersonaContext.js';

export const ProjectDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { currentPersona, setCurrentPersona } = usePersona();

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);

  // Form states
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const fetchProjects = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        headers: {
          'x-persona-id': currentPersona.id,
          'x-devcollab-persona': currentPersona.id,
        },
      });
      if (res.ok) {
        const json = await res.json();
        setProjects(json.data || []);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson?.error?.message || `Failed to load projects: HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error loading projects');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [currentPersona.id]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-persona-id': currentPersona.id,
          'x-devcollab-persona': currentPersona.id,
        },
        body: JSON.stringify({
          name: projectName.trim(),
          description: projectDescription.trim() || undefined,
        }),
      });

      const json = await res.json();
      if (res.ok && json.data?.id) {
        setShowCreateModal(false);
        setProjectName('');
        setProjectDescription('');
        navigate(`/project/${json.data.id}`);
      } else {
        setFormError(json?.error?.message || 'Failed to create project');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleJoinProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCodeInput.trim()) return;
    setFormSubmitting(true);
    setFormError(null);

    try {
      const res = await fetch('/api/projects/join', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-persona-id': currentPersona.id,
          'x-devcollab-persona': currentPersona.id,
        },
        body: JSON.stringify({
          inviteCode: inviteCodeInput.trim(),
        }),
      });

      const json = await res.json();
      if (res.ok && json.data?.id) {
        setShowJoinModal(false);
        setInviteCodeInput('');
        navigate(`/project/${json.data.id}`);
      } else {
        setFormError(json?.error?.message || 'Invalid or expired invite code');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to join project');
    } finally {
      setFormSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(text);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const getRoleBadge = (role: Role) => {
    switch (role) {
      case 'OWNER':
        return { label: 'OWNER', bg: '#4338ca', text: '#e0e7ff' };
      case 'EDITOR':
        return { label: 'EDITOR', bg: '#065f46', text: '#a7f3d0' };
      case 'VIEWER':
      default:
        return { label: 'VIEWER', bg: '#78350f', text: '#fde68a' };
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#090d16',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top Navigation */}
      <header
        style={{
          height: '60px',
          borderBottom: '1px solid #1e293b',
          backgroundColor: '#0f172a',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              backgroundColor: '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '18px',
              boxShadow: '0 0 12px rgba(99, 102, 241, 0.4)',
            }}
          >
            ⚡
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '18px', letterSpacing: '-0.02em', color: '#f8fafc' }}>
              DevCollab
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>Multiplayer IDE • CRDT Rooms</div>
          </div>
        </div>

        {/* Persona Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>ACTING AS:</span>
          <div style={{ position: 'relative' }}>
            <select
              value={currentPersona.id}
              onChange={(e) => {
                const target = DEMO_PERSONAS.find((p) => p.id === e.target.value);
                if (target) setCurrentPersona(target);
              }}
              style={{
                padding: '6px 12px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {DEMO_PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username} ({p.role})
                </option>
              ))}
            </select>
          </div>
          <div
            style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: currentPersona.avatarColor,
            }}
            title={currentPersona.username}
          />
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: '1200px', width: '100%', margin: '0 auto', padding: '36px 24px', flex: 1 }}>
        {/* Banner / Title Row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            marginBottom: '32px',
            flexWrap: 'wrap',
            gap: '16px',
          }}
        >
          <div>
            <h1 style={{ fontSize: '28px', fontWeight: 800, margin: '0 0 8px 0', letterSpacing: '-0.03em' }}>
              Workspace Projects
            </h1>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
              Choose a project room to join live collaborative editing, or create a new isolated workspace.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => {
                setFormError(null);
                setShowJoinModal(true);
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f1f5f9',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'border-color 0.2s',
              }}
            >
              <span>🔑</span>
              <span>Join with Code</span>
            </button>

            <button
              onClick={() => {
                setFormError(null);
                setShowCreateModal(true);
              }}
              style={{
                padding: '8px 18px',
                backgroundColor: '#6366f1',
                border: 'none',
                borderRadius: '6px',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 2px 8px rgba(99, 102, 241, 0.4)',
              }}
            >
              <span>+</span>
              <span>Create Project</span>
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#fca5a5',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '13px',
            }}
          >
            <span>⚠️ {error}</span>
            <button
              onClick={fetchProjects}
              style={{
                background: '#ef4444',
                border: 'none',
                color: '#fff',
                padding: '4px 10px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Project List */}
        {loading ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '20px',
            }}
          >
            {[1, 2, 3].map((n) => (
              <div
                key={n}
                style={{
                  height: '180px',
                  backgroundColor: '#111827',
                  borderRadius: '12px',
                  border: '1px solid #1f2937',
                  animation: 'pulse 1.5s infinite',
                }}
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div
            style={{
              textAlign: 'center',
              padding: '64px 20px',
              backgroundColor: '#0f172a',
              borderRadius: '12px',
              border: '1px dashed #334155',
            }}
          >
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📂</div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px 0', color: '#f8fafc' }}>
              No accessible projects found
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '14px', maxWidth: '420px', margin: '0 auto 20px auto' }}>
              {currentPersona.username} does not currently have access to any projects. Create a new workspace or enter an invite code to join one.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                padding: '8px 18px',
                backgroundColor: '#6366f1',
                border: 'none',
                borderRadius: '6px',
                color: '#ffffff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Create First Project
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
              gap: '20px',
            }}
          >
            {projects.map((proj) => {
              const roleBadge = getRoleBadge(proj.role);
              const inviteLink = proj.inviteCode
                ? `${window.location.origin}/join/${proj.inviteCode}`
                : null;

              return (
                <div
                  key={proj.id}
                  style={{
                    backgroundColor: '#111827',
                    border: '1px solid #1f2937',
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.2)',
                    transition: 'border-color 0.2s, transform 0.2s',
                  }}
                >
                  <div>
                    {/* Header: Name + Role Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <h2
                        style={{
                          fontSize: '17px',
                          fontWeight: 700,
                          margin: 0,
                          color: '#f8fafc',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '220px',
                        }}
                        title={proj.name}
                      >
                        {proj.name}
                      </h2>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          backgroundColor: roleBadge.bg,
                          color: roleBadge.text,
                          fontSize: '11px',
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {roleBadge.label}
                      </span>
                    </div>

                    {/* Description */}
                    <p
                      style={{
                        fontSize: '13px',
                        color: proj.description ? '#94a3b8' : '#475569',
                        fontStyle: proj.description ? 'normal' : 'italic',
                        margin: '0 0 16px 0',
                        lineHeight: 1.4,
                        minHeight: '36px',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {proj.description || 'No description provided.'}
                    </p>

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
                      <span>👥 {proj.memberCount} member{proj.memberCount === 1 ? '' : 's'}</span>
                      <span>📁 {proj.fileCount} file{proj.fileCount === 1 ? '' : 's'}</span>
                    </div>

                    {/* Invite Code / Link if present */}
                    {proj.inviteCode && (
                      <div
                        style={{
                          marginBottom: '16px',
                          padding: '8px 10px',
                          backgroundColor: '#0a0f1d',
                          borderRadius: '6px',
                          border: '1px solid #1e293b',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: '11px',
                        }}
                      >
                        <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>
                          Code: <strong style={{ color: '#e2e8f0' }}>{proj.inviteCode}</strong>
                        </span>
                        <button
                          onClick={() => copyToClipboard(inviteLink || proj.inviteCode || '')}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: copiedCode === (inviteLink || proj.inviteCode) ? '#10b981' : '#6366f1',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: 0,
                          }}
                        >
                          {copiedCode === (inviteLink || proj.inviteCode) ? '✓ Link Copied!' : 'Copy Invite Link'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Open Room Action */}
                  <button
                    onClick={() => navigate(`/project/${proj.id}`)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      backgroundColor: '#1e293b',
                      border: '1px solid #334155',
                      borderRadius: '6px',
                      color: '#f8fafc',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      transition: 'background-color 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#273549';
                      e.currentTarget.style.borderColor = '#475569';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#1e293b';
                      e.currentTarget.style.borderColor = '#334155';
                    }}
                  >
                    <span>Open Project IDE</span>
                    <span>→</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Modal: Create Project */}
      {showCreateModal && (
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
          onClick={() => setShowCreateModal(false)}
        >
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '24px',
              width: '100%',
              maxWidth: '440px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px 0', color: '#f8fafc' }}>
              Create New Project
            </h3>

            {formError && (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  fontSize: '12px',
                  marginBottom: '14px',
                }}
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateProject}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Distributed Consensus Engine"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                  Description (optional)
                </label>
                <textarea
                  rows={3}
                  placeholder="Brief description of the repository or team goal..."
                  value={projectDescription}
                  onChange={(e) => setProjectDescription(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '13px',
                    outline: 'none',
                    resize: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: 'transparent',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting || !projectName.trim()}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6366f1',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: formSubmitting || !projectName.trim() ? 'not-allowed' : 'pointer',
                    opacity: formSubmitting || !projectName.trim() ? 0.6 : 1,
                  }}
                >
                  {formSubmitting ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Join Project */}
      {showJoinModal && (
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
          onClick={() => setShowJoinModal(false)}
        >
          <div
            style={{
              backgroundColor: '#111827',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '24px',
              width: '100%',
              maxWidth: '440px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 16px 0', color: '#f8fafc' }}>
              Join Project via Code
            </h3>

            {formError && (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  fontSize: '12px',
                  marginBottom: '14px',
                }}
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleJoinProject}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px' }}>
                  Invite Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Paste invite code (e.g. inv_demo12345)"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#f8fafc',
                    fontSize: '13px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    fontFamily: 'monospace',
                  }}
                  autoFocus
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  style={{
                    padding: '8px 14px',
                    backgroundColor: 'transparent',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#94a3b8',
                    fontSize: '13px',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting || !inviteCodeInput.trim()}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#10b981',
                    border: 'none',
                    borderRadius: '6px',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: formSubmitting || !inviteCodeInput.trim() ? 'not-allowed' : 'pointer',
                    opacity: formSubmitting || !inviteCodeInput.trim() ? 0.6 : 1,
                  }}
                >
                  {formSubmitting ? 'Joining...' : 'Join Workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
