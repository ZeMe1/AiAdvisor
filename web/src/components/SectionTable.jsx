import React from 'react';

const timeLabel = (s) => (s.schedule ?? []).map((x) => `${x.day}.${x.time}`).join(', ');

/**
 * Таблица секций одного типа (N/P/L) — цвета строк как на портале:
 * красный = quota full, голубой = available, тёмно-синий = выбранная.
 */
export default function SectionTable({ kind, sections, selectedId, onSelect, emptyText }) {
  if (!sections?.length) {
    return emptyText ? <p className="muted small">{emptyText}</p> : null;
  }
  return (
    <table className="tbl sections-tbl">
      <thead>
        <tr>
          <th>no</th><th />
          <th>Section</th><th>Type</th><th>Teacher</th>
          <th>quota</th><th>count</th><th>res.</th>
          <th>NOTE</th><th>Time</th><th>Availability</th>
        </tr>
      </thead>
      <tbody>
        {sections.map((s, i) => {
          const cls = s.id === selectedId ? 'sec-selected' : !s.isAvailable ? 'sec-unavail' : 'sec-avail';
          return (
            <tr key={s.id} className={cls} onClick={() => s.isAvailable && onSelect(s.id)}>
              <td className="dim c">{i + 1}</td>
              <td className="c"><input type="radio" checked={s.id === selectedId} readOnly /></td>
              <td className="code nowrap">{s.courseCode.replace(' ', '')}.{s.section}</td>
              <td className="c kind">{kind}</td>
              <td>{s.teacher}</td>
              <td className="c">{s.quota}</td>
              <td className="c">{s.enrolled}</td>
              <td className="c">{s.reserved}</td>
              <td className="c small">{s.message}</td>
              <td className="small nowrap">{timeLabel(s)}</td>
              <td className={`small ${s.isAvailable ? 'avail-text' : 'unavail-text'}`}>
                {s.isAvailable ? 'Available' : 'Unavailable: quota is full'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
