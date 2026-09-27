import React from 'react';
import { DAYS, DAY_NAMES, SLOT_COUNT, slotStartLabel, slotEndLabel } from '../schedule.js';

function Chip({ c }) {
  return (
    <div
      className={`chip chip-${c.color}${c.conflict ? ' chip-conflict' : ''}${c.onClick ? ' chip-clickable' : ''}`}
      onClick={c.onClick}
      title={`${c.label}${c.teacher ? ' · ' + c.teacher : ''}${c.conflict ? ' · КОНФЛИКТ' : ''}`}
    >
      {c.label}
    </div>
  );
}

/**
 * Сетка недели Mo–Sa × 08:30–22:20 с цветными чипами:
 * basket (зелёный) / avail (голубой) / sel (тёмно-синий) / unavail (красный).
 */
export default function ScheduleGrid({ chips }) {
  const rows = Array.from({ length: SLOT_COUNT }, (_, i) => i);
  return (
    <section className="card grid-card">
      <h2 className="grid-title">Course schedule</h2>
      <div className="legend">
        <span className="chip chip-basket">In basket</span>
        <span className="chip chip-sel">Selected</span>
        <span className="chip chip-legend-conflict">Конфликт</span>
      </div>
      <div className="grid-wrap">
        <table className="grid">
          <thead>
            <tr>
              <th className="time-col" />
              {DAYS.map((d, i) => <th key={d}>{DAY_NAMES[i]} <span className="dim">({d})</span></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <td className="time-col">{slotStartLabel(row)}<br />{slotEndLabel(row)}</td>
                {DAYS.map((_, day) => (
                  <td key={day}>
                    {chips.filter((c) => c.day === day && c.row === row).map((c, i) => <Chip key={i} c={c} />)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
