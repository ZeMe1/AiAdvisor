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
        <button className="btn" onClick={onBack}>← К списку курсов</button>
        <h2 className="course-title">
          Электив — {group.name || group.code}
          <span className="muted"> · выберите курс из группы</span>
        </h2>
      </div>

      <Basket me={me} />

      <section className="card">
        <h2>Курсы на выбор ({list.length})</h2>
        {busy && <p className="muted">Загружаем список с портала…</p>}
        {!busy && error && (
          <p className="banner-warn">Не удалось получить список с портала ({error}) — показаны коды из вашей программы.</p>
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
                <td>{c.name || <span className="muted small">название появится на портале при выборе</span>}</td>
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
