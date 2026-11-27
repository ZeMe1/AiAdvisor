import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

function getPresenceBadgeStyle(status) {
  if (status === 'online') {
    return {
      dot: '#00A859',
      bg: '#E6F6EE',
      border: '#B7E4CC',
      text: '#0B6B3A',
    };
  }
  if (status === 'away') {
    return {
      dot: '#D97706',
      bg: '#FEF3C7',
      border: '#FCD34D',
      text: '#92400E',
    };
  }
  return {
    dot: '#64748B',
    bg: '#F1F5F9',
    border: '#CBD5E1',
    text: '#334155',
  };
}

export default function MyAdvisorCard() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [presence, setPresence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    const loadAdvisorAndPresence = async (isInitial = false) => {
      try {
        if (isInitial) {
          const [advRes, presRes] = await Promise.all([
            api.getMyAdvisor(),
            api.getAdvisorPresence().catch(() => null),
          ]);
          if (!mounted) return;
          setData(advRes);
          setPresence(presRes?.presence || null);
        } else if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          const presRes = await api.getAdvisorPresence().catch(() => null);
          if (mounted && presRes?.presence) {
            setPresence(presRes.presence);
          }
        }
      } catch (err) {
        if (mounted && isInitial) setError(err.message);
      } finally {
        if (mounted && isInitial) setLoading(false);
      }
    };

    loadAdvisorAndPresence(true);
    const timer = setInterval(() => loadAdvisorAndPresence(false), 20000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  if (loading) {
    return (
      <div className="card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>🎓 My Academic Advisor</h3>
        <p className="muted small" style={{ margin: 0 }}>Loading advisor details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>🎓 My Academic Advisor</h3>
        <p className="muted small" style={{ color: '#D9381E', margin: 0 }}>Could not load advisor: {error}</p>
      </div>
    );
  }

  const group = data?.group;
  const advisor = data?.advisor;
  const statusStyle = getPresenceBadgeStyle(presence?.status || 'offline');

  return (
    <div className="card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '15px', color: '#002B49' }}>
          🎓 My Academic Advisor
        </h3>
        {group && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span
              style={{
                backgroundColor: '#E8F1FB',
                color: '#002B49',
                border: '1px solid #C5DCF5',
                padding: '3px 9px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              Group: {group.name}
            </span>
            <span
              style={{
                backgroundColor: '#F1F5F9',
                color: '#334155',
                padding: '3px 9px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 600,
              }}
            >
              Year {group.study_year}
            </span>
          </div>
        )}
      </div>

      {!group ? (
        <div style={{ padding: '1rem', backgroundColor: '#F8FAFC', borderRadius: '8px', textAlign: 'center', border: '1px solid #E2E8F0' }}>
          <p className="muted" style={{ margin: 0 }}>
            You are not currently enrolled in any academic group. Please contact the registrar or department office.
          </p>
        </div>
      ) : !advisor ? (
        <div style={{ padding: '1rem', backgroundColor: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontWeight: 700, color: '#002B49' }}>Study Group: {group.name}</p>
          <p className="muted small" style={{ margin: 0 }}>Program: {group.program}</p>
          <p className="muted small" style={{ margin: '0.5rem 0 0 0' }}>
            An academic advisor has not been assigned to your group yet.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.85rem',
            padding: '1rem',
            backgroundColor: '#F8FAFC',
            border: '1px solid #D8E4F0',
            borderRadius: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                backgroundColor: '#002B49',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.35rem',
                fontWeight: 700,
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {advisor.avatar_url ? (
                <img
                  src={advisor.avatar_url}
                  alt={advisor.display_name || advisor.username}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                (advisor.display_name || advisor.username || 'A')[0].toUpperCase()
              )}
            </div>

            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '15px', color: '#002B49' }}>
                  {advisor.display_name || advisor.username}
                </span>
                <span
                  style={{
                    backgroundColor: '#E6F4EA',
                    color: '#0B6B3A',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 700,
                  }}
                >
                  Advisor
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    backgroundColor: statusStyle.bg,
                    border: `1px solid ${statusStyle.border}`,
                    color: statusStyle.text,
                    padding: '2px 9px',
                    borderRadius: '999px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      backgroundColor: statusStyle.dot,
                    }}
                  />
                  {presence?.statusText || 'Offline'}
                </span>
              </div>
              <div className="muted small" style={{ marginTop: '4px' }}>
                {group.program} · Group {group.name}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/messages')}
              style={{ fontWeight: 600, padding: '7px 14px' }}
            >
              Message Advisor →
            </button>
          </div>

          {(presence?.officeHours || presence?.responseTimeNote) && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem 1.5rem',
                paddingTop: '0.65rem',
                borderTop: '1px solid #E2E8F0',
                fontSize: '12.5px',
                color: '#1E293B',
              }}
            >
              {presence?.officeHours && (
                <div>
                  <strong style={{ color: '#002B49' }}>Office Hours:</strong> {presence.officeHours}
                </div>
              )}
              {presence?.responseTimeNote && (
                <div className="muted">
                  <strong style={{ color: '#334155' }}>Typical Response:</strong> {presence.responseTimeNote}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
