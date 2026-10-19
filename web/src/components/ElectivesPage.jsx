import React from 'react';
import Basket from './Basket.jsx';

/**
 * Страница элективной группы (заглушка XXX 10X и т.п.): список курсов на выбор.
 * Выбор курса -> страница лекций/практик (CoursePage).
 */
export default function ElectivesPage({ me, group, list, busy, error, onChoose, onBack }) {
  return (
    <>
      <div className="course-topline">
        <button className="btn" onClick={onBack}>← Back to courses</button>
        <h2 className="course-title">
          Elective — {group.name || group.code}
          <span className="muted"> · select a course from the group</span>
        </h2>
      </div>

      <Basket me={me} />

      <section className="card">
        <h2>Available Courses ({list.length})</h2>
        {busy && <p className="muted">Loading course list from portal…</p>}
        {!busy && error && (
          <p className="banner-warn">Could not load list from portal ({error}) — showing candidate codes from curriculum.</p>
        )}
        <table className="tbl">
          <thead>
            <tr>
              <th>№</th><th>course code</th><th>name</th><th>cr</th><th>ects</th><th>status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c, i) => (
              <tr key={c.code} className="st-not-taken">
                <td className="dim c">{i + 1}</td>
                <td className="code">{c.code}</td>
                <td>{c.name || <span className="muted small">title will appear upon selection</span>}</td>
                <td className="c">{c.credits ?? '—'}</td>
                <td className="c">{c.ects ?? '—'}</td>
                <td className="c">
                  <button className="btn" onClick={() => onChoose(c)}>Choose</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
