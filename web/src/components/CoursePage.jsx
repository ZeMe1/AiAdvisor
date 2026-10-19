import React from 'react';
import Basket from './Basket.jsx';
import SectionTable from './SectionTable.jsx';
import ScheduleGrid from './ScheduleGrid.jsx';

/**
 * Страница курса (после Choose): Корзина -> Лекции -> Практики выбранной
 * лекции -> Сетка расписания. На сетке горят только кликнутые слоты.
 */
export default function CoursePage({ me, open, draft, setDraft, chips, conflict, onAdd, onBack }) {
  const { code, name, data } = open;
  const theory = data.theory.find((s) => s.id === draft.N) ?? null;

  // Практики выбранной лекции: у каждой theory в данных есть список её practiceIds.
  let practices = null;
  let ownPractices = true;
  if (theory) {
    const own = data.practice.filter((p) => theory.practiceIds?.includes(p.id));
    if (own.length) { practices = own; }
    else { practices = data.practice; ownPractices = false; }
  }
  const practice = practices?.find((s) => s.id === draft.P) ?? null;
  const lab = data.lab?.find((s) => s.id === draft.L) ?? null;
  const canAdd = theory && (!practices || practices.length === 0 || practice);

  return (
    <>
      <div className="course-topline">
        <button className="btn" onClick={onBack}>← Back to courses</button>
        <h2 className="course-title">
          {code} — {name || '?'}
          <span className="muted"> [{data.course.hours}] / {data.course.ects} ects</span>
        </h2>
      </div>

      <Basket me={me} />

      <section className="card">
        <h2>Step 1 · Theory (Lecture) sections <span className="muted small">— select lecture</span></h2>
        <SectionTable
          kind="N" sections={data.theory} selectedId={draft.N}
          onSelect={(id) => setDraft({ ...draft, N: id })}
        />
      </section>

      {theory && data.practice.length > 0 && (
        <section className="card">
          <h2>
            Step 2 · Practice sections{' '}
            <span className="muted small">
              {ownPractices ? '— practices for selected lecture' : '— no linked practices for this lecture, showing all'}
            </span>
          </h2>
          <SectionTable
            kind="P" sections={practices} selectedId={draft.P}
            onSelect={(id) => setDraft({ ...draft, P: id })}
          />
          <div className="panel-actions">
            <button className="btn btn-primary" disabled={!canAdd} onClick={() => onAdd({ theory, practice })}>
              add to plan
            </button>
            <span className="muted small">Courses are saved locally — this is only your plan, not sent to SDU.</span>
          </div>
        </section>
      )}

      {theory && data.practice.length === 0 && (
        <div className="panel-actions card">
          <button className="btn btn-primary" onClick={() => onAdd({ theory, practice: null })}>add to plan</button>
          <span className="muted small">This course has no practice sections — adding lecture only.</span>
        </div>
      )}

      {theory && data.lab?.length > 0 && (
        <section className="card">
          <h2>Lab sections</h2>
          <SectionTable
            kind="L" sections={data.lab} selectedId={draft.L}
            onSelect={(id) => setDraft({ ...draft, L: id })}
          />
        </section>
      )}

      {conflict && (
        <div className="banner-warn">
          ⚠ Selected slots conflict in time with course basket or other planned courses — outlined in red on the grid.
        </div>
      )}

      <ScheduleGrid chips={chips} />
    </>
  );
}
