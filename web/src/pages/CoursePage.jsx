import React, { useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Basket from '../components/Basket.jsx';
import SectionTable from '../components/SectionTable.jsx';
import ScheduleGrid from '../components/ScheduleGrid.jsx';
import { useAuthStore } from '../stores/authStore.js';
import { usePlanStore } from '../stores/planStore.js';
import { useScheduleStore } from '../stores/scheduleStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

export default function CoursePage() {
  const { code } = useParams();
  const [searchParams] = useSearchParams();
  const mufSqId = searchParams.get('mufSqId') || undefined;
  const navigate = useNavigate();
  const toast = useToast();

  const { me } = useAuthStore();
  const { addToPlan } = usePlanStore();
  const {
    openCourse,
    draft,
    setDraft,
    loadingCourse,
    courseError,
    loadCourse,
    clearOpenCourse,
    getScheduleChips,
  } = useScheduleStore();

  const toastRef = React.useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    if (!code) return;
    const decodedCode = decodeURIComponent(code);
    if (/^XXX/i.test(decodedCode)) return;

    loadCourse(decodedCode, mufSqId).catch((err) => {
      toastRef.current.error('Ошибка загрузки курса: ' + err.message);
    });
    return () => {
      clearOpenCourse();
    };
  }, [code, mufSqId, loadCourse, clearOpenCourse]);

  if (code && /^XXX/i.test(decodeURIComponent(code))) {
    return (
      <main className="page">
        <div className="card">
          <button className="btn" onClick={() => navigate('/')}>← Назад к куррикулуму</button>
          <div className="banner-warn" style={{ marginTop: '16px' }}>
            Код <b>{decodeURIComponent(code)}</b> обозначает группу элективов. Пожалуйста, выберите конкретный курс из предложенных вариантов в куррикулуме.
          </div>
        </div>
      </main>
    );
  }

  if (loadingCourse) {
    return (
      <main className="page">
        <div className="card">
          <p className="muted">Загрузка информации о секциях курса {code}…</p>
        </div>
      </main>
    );
  }

  if (courseError || !openCourse) {
    return (
      <main className="page">
        <div className="card">
          <button className="btn" onClick={() => navigate('/')}>← Назад</button>
          <div className="banner-error" style={{ marginTop: '12px' }}>
            {courseError || 'Курс не найден'}
          </div>
        </div>
      </main>
    );
  }

  const { data } = openCourse;
  const theory = data.theory.find((s) => s.id === draft.N) ?? null;

  let practices = null;
  let ownPractices = true;
  if (theory) {
    const own = data.practice.filter((p) => theory.practiceIds?.includes(p.id));
    if (own.length) {
      practices = own;
    } else {
      practices = data.practice;
      ownPractices = false;
    }
  }

  const practice = practices?.find((s) => s.id === draft.P) ?? null;
  const lab = data.lab?.find((s) => s.id === draft.L) ?? null;
  const canAdd = theory && (!practices || practices.length === 0 || practice);

  const chips = getScheduleChips(true);
  const conflict = chips.some((c) => c.conflict && c.color === 'sel');

  const handleAdd = () => {
    addToPlan({
      code: openCourse.code,
      name: openCourse.name,
      theory,
      practice,
      lab,
    });
    toast.success(`Курс ${openCourse.code} успешно добавлен в план!`);
    navigate('/');
  };

  return (
    <main className="page">
      <div className="course-topline">
        <button className="btn" onClick={() => navigate('/')}>← К списку курсов</button>
        <h2 className="course-title">
          {openCourse.code} — {openCourse.name || '?'}
          <span className="muted"> [{data.course.hours}] / {data.course.ects} ects</span>
        </h2>
      </div>

      <Basket me={me} />

      <section className="card">
        <h2>Шаг 1 · Theory (Lecture) sections <span className="muted small">— выберите лекцию</span></h2>
        <SectionTable
          kind="N"
          sections={data.theory}
          selectedId={draft.N}
          onSelect={(id) => setDraft({ ...draft, N: id })}
        />
      </section>

      {theory && data.practice.length > 0 && (
        <section className="card">
          <h2>
            Шаг 2 · Practice sections{' '}
            <span className="muted small">
              {ownPractices ? '— практики выбранной лекции' : '— у этой лекции нет привязанных практик, показаны все'}
            </span>
          </h2>
          <SectionTable
            kind="P"
            sections={practices}
            selectedId={draft.P}
            onSelect={(id) => setDraft({ ...draft, P: id })}
          />
          <div className="panel-actions">
            <button className="btn btn-primary" disabled={!canAdd} onClick={handleAdd}>
              add to plan
            </button>
            <span className="muted small">Добавление никуда не записывается в SDU — это только ваш план.</span>
          </div>
        </section>
      )}

      {theory && data.practice.length === 0 && (
        <div className="panel-actions card">
          <button className="btn btn-primary" onClick={handleAdd}>add to plan</button>
          <span className="muted small">У курса нет практик — добавляем только лекцию.</span>
        </div>
      )}

      {theory && data.lab?.length > 0 && (
        <section className="card">
          <h2>Lab sections</h2>
          <SectionTable
            kind="L"
            sections={data.lab}
            selectedId={draft.L}
            onSelect={(id) => setDraft({ ...draft, L: id })}
          />
        </section>
      )}

      {conflict && (
        <div className="banner-warn">
          ⚠ Выбранные слоты пересекаются по времени с корзиной или другими курсами плана — они обведены красным на сетке.
        </div>
      )}

      <ScheduleGrid chips={chips} />
    </main>
  );
}
