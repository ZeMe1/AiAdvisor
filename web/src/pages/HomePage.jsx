import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Basket from '../components/Basket.jsx';
import Curriculum from '../components/Curriculum.jsx';
import { useAuthStore } from '../stores/authStore.js';
import { usePlanStore } from '../stores/planStore.js';
import { useScheduleStore } from '../stores/scheduleStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

const timeStr = (sec) => (sec?.schedule ?? []).map((s) => `${s.day}.${s.time}`).join(', ');

export default function HomePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const { me } = useAuthStore();
  const { plan, dropFromPlan } = usePlanStore();
  const { curriculum, loadingCurriculum, loadCurriculum, loadEligibility, getScheduleChips } = useScheduleStore();

  const [search, setSearch] = useState('');

  const toastRef = React.useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    loadCurriculum(true).catch((err) => {
      toastRef.current.error('Failed to load curriculum: ' + err.message);
    });
    loadEligibility().catch(console.error);
  }, [loadCurriculum, loadEligibility]);

  const chips = getScheduleChips(false);
  const hasConflict = chips.some((c) => c.conflict);

  const handleSearch = () => {
    const trimmed = search.trim();
    if (!trimmed) return;
    if (/^XXX/i.test(trimmed)) {
      toast.warn('Cannot search by elective placeholder code. Please choose a specific course.');
      return;
    }
    navigate(`/courses/${encodeURIComponent(trimmed)}`);
  };

  const handleChoose = (course) => {
    const isElective = course.isElective || /^XXX/i.test(course.code);
    if (isElective) {
      if (course.elective) {
        const mufSqId = course.elective.mufSqId;
        navigate(`/electives/${encodeURIComponent(course.code)}${mufSqId ? `?mufSqId=${encodeURIComponent(mufSqId)}` : ''}`, { state: { course } });
      } else {
        toast.warn(`Elective group ${course.code} has no available options in current program.`);
      }
    } else {
      const mufSqId = course.sectionsParams?.mufSqId;
      navigate(`/courses/${encodeURIComponent(course.code)}${mufSqId ? `?mufSqId=${encodeURIComponent(mufSqId)}` : ''}`);
    }
  };

  return (
    <main className="page">
      <section className="card search-card">
        <h2>Use one of three ways to pick a course</h2>
        <div className="search-row">
          <input
            value={search}
            placeholder="Search by course code, e.g. CSS 410"
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button className="btn btn-primary" disabled={!search.trim()} onClick={handleSearch}>
            Search
          </button>
        </div>
        <p className="muted small">
          1 — search by course code · 2 — click Choose in curriculum below · 3 — candidate codes in electives
        </p>
      </section>

      <Basket me={me} />

      <section className="card">
        <h2>
          📝 My Plan <span className="muted small">(stored locally, not submitted to SDU)</span>
        </h2>
        {plan.length === 0 && (
          <p className="muted">Empty — choose course sections via Choose or Search.</p>
        )}
        {plan.map((p) => (
          <div className="plan-row" key={p.code}>
            <div>
              <b className="code">{p.code}</b> {p.name}
              <div className="small muted">
                N {p.theory.section} ({p.theory.teacher}) {timeStr(p.theory)}
                {p.practice && (
                  <> · P {p.practice.section} ({p.practice.teacher}) {timeStr(p.practice)}</>
                )}
              </div>
            </div>
            <button className="btn btn-mini" onClick={() => dropFromPlan(p.code)}>
              drop
            </button>
          </div>
        ))}
        {plan.length > 0 && hasConflict && (
          <div className="banner-warn">
            ⚠ Schedule conflicts detected between planned courses and/or basket — open course to see details on the grid.
          </div>
        )}
      </section>

      {loadingCurriculum && !curriculum ? (
        <section className="card">
          <p className="muted">Loading curriculum…</p>
        </section>
      ) : curriculum ? (
        <Curriculum curriculum={curriculum} onChoose={handleChoose} />
      ) : null}
    </main>
  );
}
