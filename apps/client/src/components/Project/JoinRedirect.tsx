import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePersona } from '../../context/PersonaContext.js';

export const JoinRedirect: React.FC = () => {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();
  const { currentPersona } = usePersona();

  const [status, setStatus] = useState<'joining' | 'error'>('joining');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteCode) {
      setStatus('error');
      setErrorMessage('Missing invite code in URL.');
      return;
    }

    let ignore = false;
    async function join() {
      try {
        const res = await fetch('/api/projects/join', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-persona-id': currentPersona.id,
            'x-devcollab-persona': currentPersona.id,
          },
          body: JSON.stringify({ inviteCode }),
        });

        const json = await res.json();
        if (!ignore) {
          if (res.ok && json.data?.id) {
            navigate(`/project/${json.data.id}`, { replace: true });
          } else {
            setStatus('error');
            setErrorMessage(json?.error?.message || 'Invalid or expired invite code.');
          }
        }
      } catch (err) {
        if (!ignore) {
          setStatus('error');
          setErrorMessage(err instanceof Error ? err.message : 'Network error joining project');
        }
      }
    }

    join();
    return () => {
      ignore = true;
    };
  }, [inviteCode, currentPersona.id, navigate]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#090d16',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          backgroundColor: '#111827',
          border: '1px solid #1f2937',
          borderRadius: '12px',
          padding: '32px',
          maxWidth: '420px',
          width: '100%',
          textAlign: 'center',
        }}
      >
        {status === 'joining' ? (
          <>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>⏳</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 700 }}>
              Joining Workspace...
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: 0 }}>
              Resolving invite code <code>{inviteCode}</code> for {currentPersona.username}...
            </p>
          </>
        ) : (
          <>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>❌</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', fontWeight: 700, color: '#f87171' }}>
              Invitation Failed
            </h3>
            <p style={{ color: '#94a3b8', fontSize: '13px', margin: '0 0 20px 0' }}>
              {errorMessage}
            </p>
            <button
              onClick={() => navigate('/', { replace: true })}
              style={{
                padding: '8px 16px',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '6px',
                color: '#f8fafc',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ← Back to Projects Dashboard
            </button>
          </>
        )}
      </div>
    </div>
  );
};
