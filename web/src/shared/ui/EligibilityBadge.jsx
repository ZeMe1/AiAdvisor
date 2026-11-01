import React from 'react';

/**
 * Бейдж соответствия пререквизитам (US12).
 * Цветовая система: зеленый (Eligible), красный (Not eligible), желтый (Corequisite).
 */
export default function EligibilityBadge({ status, missingCount = 0 }) {
  if (!status) return null;

  switch (status) {
    case 'eligible':
      return (
        <span
          className="badge-eligibility badge-eligible"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: 600,
            backgroundColor: '#e6f4ea',
            color: '#137333',
            border: '1px solid #ceead6',
            whiteSpace: 'nowrap',
          }}
        >
          ● Eligible
        </span>
      );
    case 'not_eligible':
      return (
        <span
          className="badge-eligibility badge-not-eligible"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: 600,
            backgroundColor: '#fce8e6',
            color: '#c5221f',
            border: '1px solid #fad2cf',
            whiteSpace: 'nowrap',
          }}
        >
          ✕ Not eligible {missingCount > 0 ? `(${missingCount})` : ''}
        </span>
      );
    case 'corequisite':
      return (
        <span
          className="badge-eligibility badge-corequisite"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '0.75rem',
            fontWeight: 600,
            backgroundColor: '#fef7e0',
            color: '#b06000',
            border: '1px solid #feefc3',
            whiteSpace: 'nowrap',
          }}
        >
          ▲ Corequisite
        </span>
      );
    default:
      return null;
  }
}
