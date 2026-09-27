import React from 'react';

/** Корзина/утверждённые регистрации — как «List of Courses in Basket» на портале. */
export default function Basket({ me }) {
  const credits = me.approved.reduce((a, c) => a + (Number(c.credits) || 0), 0);
  const ects = me.approved.reduce((a, c) => a + (Number(c.ects) || 0), 0);

  return (
    <section className="card">
      <h2>🛒 Корзина курсов — {me.term}</h2>
      {me.isApproved && <p className="muted">Регистрация на семестр подтверждена.</p>}
      <table className="tbl">
        <thead>
          <tr>
            <th>№</th><th>course</th><th>N</th><th>P</th><th>name</th>
            <th>credits</th><th>ects</th><th>STATUS</th>
          </tr>
        </thead>
        <tbody>
          {me.approved.map((c, i) => (
            <tr key={`${c.code}-${i}`}>
              <td className="dim">{i + 1}</td>
              <td className="code">{c.code}</td>
              <td title={c.normalTeacher ?? ''}><i>{c.normalSection}</i></td>
              <td title={c.practiceTeacher ?? ''}><i>{c.practiceSection}</i></td>
              <td>{c.name}</td>
              <td className="c" title={c.hours ?? ''}>{c.credits}</td>
              <td className="c">{c.ects}</td>
              <td className="c st-first">{c.status}</td>
            </tr>
          ))}
          <tr className="total-row">
            <td colSpan={5}>Total:</td>
            <td className="c"><b>{credits}</b></td>
            <td className="c"><b>{ects}</b></td>
            <td />
          </tr>
        </tbody>
      </table>
      {me.user?.granted != null && (
        <p className="quota-line">
          GRANTED: <b>{me.user.granted}</b> &nbsp;|&nbsp; USED: <b>{me.user.used}</b>
          &nbsp;|&nbsp; LEFT: <b>{me.user.left}</b>
        </p>
      )}
    </section>
  );
}
