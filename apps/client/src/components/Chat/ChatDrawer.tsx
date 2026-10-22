import React, { useState, useEffect, useRef } from 'react';
import type { ChatItem } from '../../types.js';

interface ChatDrawerProps {
  messages: ChatItem[];
  onSendMessage: (content: string) => void;
  onClose: () => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({ messages, onSendMessage, onClose }) => {
  const [content, setContent] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    onSendMessage(content.trim());
    setContent('');
  };

  return (
    <div
      style={{
        width: '300px',
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
        <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>PROJECT CHAT</span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '14px' }}
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.length === 0 ? (
          <div style={{ color: '#475569', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
            No messages yet. Say hi to your team!
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    backgroundColor: msg.avatarColor,
                    display: 'inline-block',
                  }}
                />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>{msg.username}</span>
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div
                style={{
                  backgroundColor: '#1e293b',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: '#f8fafc',
                  marginLeft: '22px',
                  wordBreak: 'break-word',
                }}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={handleSubmit}
        style={{
          padding: '10px',
          borderTop: '1px solid #1e293b',
          display: 'flex',
          gap: '6px',
        }}
      >
        <input
          type="text"
          placeholder="Type message..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          style={{
            flex: 1,
            padding: '6px 10px',
            backgroundColor: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '4px',
            color: '#f8fafc',
            fontSize: '12px',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '6px 12px',
            backgroundColor: '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
};
