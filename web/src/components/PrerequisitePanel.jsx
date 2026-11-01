import React from 'react';
import { useNavigate } from 'react-router-dom';
import EligibilityBadge from '../shared/ui/EligibilityBadge.jsx';

export default function PrerequisitePanel({ eligibility }) {
  const navigate = useNavigate();

  if (!eligibility) return null;

  const { status, missingPrerequisites = [], reason } = eligibility;

  if (status === 'eligible') {
    return (
      <div
        className="card"
        style={{
          padding: '12px 16px',
          marginBottom: '16px',
          borderLeft: '4px solid #34a853',
          backgroundColor: '#f6fbf7',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <EligibilityBadge status="eligible" />
          <span style={{ fontSize: '0.9rem', color: '#137333', fontWeight: 500 }}>
            Все необходимые пререквизиты выполнены. Курс доступен для регистрации.
          </span>
        </div>
      </div>
    );
  }

  if (status === 'corequisite') {
    return (
      <div
        className="card"
        style={{
          padding: '12px 16px',
          marginBottom: '16px',
          borderLeft: '4px solid #f9ab00',
          backgroundColor: '#fffdf6',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <EligibilityBadge status="corequisite" />
          <span style={{ fontSize: '0.9rem', color: '#b06000', fontWeight: 500 }}>
            {reason || 'Кореквизит: предмет может изучаться параллельно.'}
          </span>
        </div>
      </div>
    );
  }

  if (status === 'not_eligible') {
    return (
      <div
        className="card"
        style={{
          padding: '16px',
          marginBottom: '16px',
          borderLeft: '4px solid #ea4335',
          backgroundColor: '#fef7f6',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <EligibilityBadge status="not_eligible" missingCount={missingPrerequisites.length} />
          <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#c5221f' }}>
            Курс недоступен: не закрыты пререквизиты
          </span>
        </div>

        <p style={{ margin: '4px 0 12px 0', fontSize: '0.85rem', color: '#5f6368' }}>
          Для записи на данный курс необходимо предварительно завершить следующие дисциплины:
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {missingPrerequisites.map((m) => (
            <div
              key={m.code}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                backgroundColor: '#ffffff',
                border: '1px solid #fad2cf',
                borderRadius: '6px',
              }}
            >
              <div>
                <strong style={{ color: '#202124', marginRight: '8px' }}>{m.code}</strong>
                <span className="muted small">Минимальная оценка: <b>{m.minGrade || 'D'}</b></span>
                {m.reason && <div className="muted small" style={{ color: '#d93025' }}>{m.reason}</div>}
              </div>
              <button
                className="btn"
                style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                onClick={() => navigate(`/courses/${encodeURIComponent(m.code)}`)}
              >
                Перейти к {m.code} →
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}
