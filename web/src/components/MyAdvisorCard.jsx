import React, { useState, useEffect } from 'react';
import { api } from '../api.js';

export default function MyAdvisorCard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api.getMyAdvisor()
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch((err) => {
        if (mounted) setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
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
        <p className="muted small" style={{ color: '#c00', margin: 0 }}>Could not load advisor: {error}</p>
      </div>
    );
  }

  const group = data?.group;
  const advisor = data?.advisor;

  return (
    <div className="card" style={{ marginTop: '1.5rem', padding: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          🎓 My Academic Advisor
        </h3>
        {group && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span
              style={{
                backgroundColor: '#e8f0fe',
                color: '#1a73e8',
                padding: '3px 8px',
                borderRadius: '12px',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
            >
              Group: {group.name}
            </span>
            <span
              style={{
                backgroundColor: '#f1f3f4',
                color: '#5f6368',
                padding: '3px 8px',
                borderRadius: '12px',
                fontSize: '12px',
              }}
            >
              Year {group.study_year}
            </span>
          </div>
        )}
      </div>

      {!group ? (
        <div style={{ padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '6px', textAlign: 'center' }}>
          <p className="muted" style={{ margin: 0 }}>
            You are not currently enrolled in any academic group. Please contact the registrar or department office.
          </p>
        </div>
      ) : !advisor ? (
        <div style={{ padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '6px' }}>
          <p style={{ margin: '0 0 0.25rem 0', fontWeight: 'bold' }}>Study Group: {group.name}</p>
          <p className="muted small" style={{ margin: 0 }}>Program: {group.program}</p>
          <p className="muted small" style={{ margin: '0.5rem 0 0 0', color: '#888' }}>
            An academic advisor has not been assigned to your group yet.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            padding: '1rem',
            backgroundColor: '#f8fbf8',
            border: '1px solid #e0f0e0',
            borderRadius: '8px',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: '#1b5e20',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.4rem',
              fontWeight: 'bold',
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

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 'bold', fontSize: '15px' }}>
                {advisor.display_name || advisor.username}
              </span>
              <span
                style={{
                  backgroundColor: '#e6f4ea',
                  color: '#137333',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                Advisor
              </span>
            </div>
            <div className="muted small" style={{ marginTop: '2px' }}>
              {group.program} (Group {group.name})
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
