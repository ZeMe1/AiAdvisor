import React, { useState, useRef, useEffect } from 'react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseIsoDate(str) {
  if (!str || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default function EnglishDatePicker({ value, onChange, placeholder = 'YYYY-MM-DD' }) {
  const parsed = parseIsoDate(value);
  const now = new Date();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState((parsed || now).getFullYear());
  const [viewMonth, setViewMonth] = useState((parsed || now).getMonth());
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const handleOpenToggle = () => {
    if (!open) {
      const base = parseIsoDate(value) || new Date();
      setViewYear(base.getFullYear());
      setViewMonth(base.getMonth());
    }
    setOpen((prev) => !prev);
  };

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayIso = toIsoDate(new Date());

  const cells = [];
  for (let i = 0; i < firstDay; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toIsoDate(new Date(viewYear, viewMonth, day)));
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          border: '1px solid #b9c4cf',
          borderRadius: '4px',
          backgroundColor: '#fff',
          width: '150px',
          overflow: 'hidden',
        }}
      >
        <input
          type="text"
          readOnly
          value={value || ''}
          placeholder={placeholder}
          onClick={handleOpenToggle}
          style={{
            border: 'none',
            outline: 'none',
            width: '100%',
            padding: '6px 8px',
            cursor: 'pointer',
            backgroundColor: 'transparent',
            fontSize: '13px',
          }}
        />
        {value && (
          <button
            type="button"
            aria-label="Clear date"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#6b7a8c',
              cursor: 'pointer',
              padding: '0 4px',
              fontSize: '14px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
        <button
          type="button"
          aria-label="Open calendar"
          onClick={handleOpenToggle}
          style={{
            border: 'none',
            borderLeft: '1px solid #e2e8f0',
            background: '#f8fafc',
            color: '#002B49',
            cursor: 'pointer',
            padding: '6px 8px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            width: '248px',
            backgroundColor: '#fff',
            border: '1px solid #c9d4e0',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 43, 73, 0.16)',
            padding: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <button type="button" className="btn btn-mini" onClick={prevMonth} aria-label="Previous month">
              ‹
            </button>
            <strong style={{ fontSize: '13px', color: '#002B49' }}>
              {MONTHS[viewMonth]} {viewYear}
            </strong>
            <button type="button" className="btn btn-mini" onClick={nextMonth} aria-label="Next month">
              ›
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', textAlign: 'center', marginBottom: '4px' }}>
            {WEEKDAYS.map((wd) => (
              <div key={wd} style={{ fontSize: '11px', fontWeight: 700, color: '#6b7a8c', padding: '2px 0' }}>
                {wd}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
            {cells.map((iso, idx) => {
              if (!iso) return <div key={`empty-${idx}`} />;
              const isSelected = value === iso;
              const isToday = iso === todayIso;
              const dayNum = Number(iso.slice(8, 10));
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  style={{
                    border: isToday && !isSelected ? '1px solid #0070BA' : '1px solid transparent',
                    borderRadius: '4px',
                    padding: '5px 0',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: isSelected || isToday ? 700 : 500,
                    backgroundColor: isSelected ? '#0070BA' : 'transparent',
                    color: isSelected ? '#fff' : '#1c2733',
                  }}
                >
                  {dayNum}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', paddingTop: '6px', borderTop: '1px solid #e6ecf2' }}>
            <button
              type="button"
              className="btn btn-mini"
              onClick={() => {
                onChange(todayIso);
                setOpen(false);
              }}
            >
              Today
            </button>
            <button
              type="button"
              className="btn btn-mini"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
