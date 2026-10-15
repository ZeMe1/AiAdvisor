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
  const { curriculum, loadingCurriculum, loadCurriculum, getScheduleChips } = useScheduleStore();

  const [search, setSearch] = useState('');

  useEffect(() => {
    loadCurriculum().catch((err) => {
      toast.error('Не удалось загрузить куррикулум: ' + err.message);
    });
  }, [loadCurriculum, toast]);

  const chips = getScheduleChips(false);
  const hasConflict = chips.some((c) => c.conflict);

  const handleSearch = () => {
    const trimmed = search.trim();
    if (!trimmed) return;
    navigate(`/courses/${encodeURIComponent(trimmed)}`);
  };

  const handleChoose = (course) => {
    if (course.isElective && course.elective) {
      navigate(`/electives/${encodeURIComponent(course.code)}`, { state: { course } });
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
          1 — поиск по коду · 2 — Choose в куррикулуме ниже · 3 — коды кандидатов у элективов
        </p>
      </section>

      <Basket me={me} />

      <section className="card">
        <h2>
          📝 Мой план <span className="muted small">(хранится локально, в SDU не отправляется)</span>
        </h2>
        {plan.length === 0 && (
          <p className="muted">Пусто — выберите секции курса через Choose или поиск.</p>
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
            ⚠ Есть пересечения по времени между курсами плана и/или корзиной — открой курс, чтобы увидеть детали на сетке.
          </div>
        )}
      </section>

      {loadingCurriculum && !curriculum ? (
        <section className="card">
          <p className="muted">Куррикулум загружается…</p>
        </section>
      ) : curriculum ? (
        <Curriculum curriculum={curriculum} onChoose={handleChoose} />
      ) : null}
    </main>
  );
}
