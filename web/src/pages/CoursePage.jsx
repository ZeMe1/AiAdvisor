import React, { useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import Basket from '../components/Basket.jsx';
import SectionTable from '../components/SectionTable.jsx';
import ScheduleGrid from '../components/ScheduleGrid.jsx';
import PrerequisitePanel from '../components/PrerequisitePanel.jsx';
import EligibilityBadge from '../shared/ui/EligibilityBadge.jsx';
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
    eligibilityMap,
    loadEligibility,
  } = useScheduleStore();

  const toastRef = React.useRef(toast);
  toastRef.current = toast;

  const decodedCode = code ? decodeURIComponent(code).trim() : '';

  useEffect(() => {
    if (!decodedCode) return;
    if (/^XXX/i.test(decodedCode)) return;

    loadCourse(decodedCode, mufSqId).catch((err) => {
      toastRef.current.error('Failed to load course: ' + err.message);
    });

    if (!eligibilityMap || Object.keys(eligibilityMap).length === 0) {
      loadEligibility().catch(console.error);
    }

    return () => {
      clearOpenCourse();
    };
  }, [decodedCode, mufSqId, loadCourse, clearOpenCourse, eligibilityMap, loadEligibility]);

  if (decodedCode && /^XXX/i.test(decodedCode)) {
    return (
      <main className="page">
        <div className="card">
          <button className="btn" onClick={() => navigate('/')}>← Back to curriculum</button>
          <div className="banner-warn" style={{ marginTop: '16px' }}>
            Code <b>{decodedCode}</b> indicates an elective group. Please choose a specific course from the curriculum.
          </div>
        </div>
      </main>
    );
  }

  if (loadingCourse) {
    return (
      <main className="page">
        <div className="card">
          <p className="muted">Loading section info for {code}…</p>
        </div>
      </main>
    );
  }

  if (courseError || !openCourse) {
    return (
      <main className="page">
        <div className="card">
          <button className="btn" onClick={() => navigate('/')}>← Back</button>
          <div className="banner-error" style={{ marginTop: '12px' }}>
            {courseError || 'Course not found'}
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

  const courseEligibility = eligibilityMap?.[decodedCode.toUpperCase()];
  const isNotEligible = courseEligibility?.status === 'not_eligible';

  const chips = getScheduleChips(true);
  const conflict = chips.some((c) => c.conflict && c.color === 'sel');

  const handleAdd = () => {
    if (isNotEligible) {
      toast.error('Cannot add to plan: prerequisites not satisfied!');
      return;
    }
    addToPlan({
      code: openCourse.code,
      name: openCourse.name,
      theory,
      practice,
      lab,
    });
    toast.success(`Course ${openCourse.code} successfully added to plan!`);
    navigate('/');
  };

  return (
    <main className="page">
      <div className="course-topline">
        <button className="btn" onClick={() => navigate('/')}>← Back to courses</button>
        <h2 className="course-title" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span>{openCourse.code} — {openCourse.name || '?'}</span>
          <span className="muted"> [{data.course.hours}] / {data.course.ects} ects</span>
          {courseEligibility && (
            <EligibilityBadge
              status={courseEligibility.status}
              missingCount={courseEligibility.missingPrerequisites?.length}
            />
          )}
        </h2>
      </div>

      <Basket me={me} />

      <PrerequisitePanel eligibility={courseEligibility} />

      <section className="card">
        <h2>Step 1 · Theory (Lecture) sections <span className="muted small">— select lecture</span></h2>
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
            Step 2 · Practice sections{' '}
            <span className="muted small">
              {ownPractices ? '— practice sections for selected lecture' : '— no practices linked to this lecture, showing all'}
            </span>
          </h2>
          <SectionTable
            kind="P"
            sections={practices}
            selectedId={draft.P}
            onSelect={(id) => setDraft({ ...draft, P: id })}
          />
          <div className="panel-actions">
            <button
              className="btn btn-primary"
              disabled={!canAdd || isNotEligible}
              title={isNotEligible ? 'Prerequisites not satisfied' : undefined}
              onClick={handleAdd}
            >
              add to plan
            </button>
            <span className="muted small">Saved locally — this is your private study plan.</span>
          </div>
          {isNotEligible && (
            <div className="banner-warn" style={{ marginTop: '8px' }}>
              ⚠ Registration blocked: prerequisite requirements not satisfied.
            </div>
          )}
        </section>
      )}

      {theory && data.practice.length === 0 && (
        <div className="panel-actions card">
          <button
            className="btn btn-primary"
            disabled={isNotEligible}
            title={isNotEligible ? 'Prerequisites not satisfied' : undefined}
            onClick={handleAdd}
          >
            add to plan
          </button>
          <span className="muted small">This course has no practice sections — lecture only.</span>
          {isNotEligible && (
            <div className="banner-warn" style={{ marginTop: '8px' }}>
              ⚠ Registration blocked: prerequisite requirements not satisfied.
            </div>
          )}
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
          ⚠ Selected slots conflict with basket or planned courses — highlighted in red on the grid.
        </div>
      )}

      <ScheduleGrid chips={chips} />
    </main>
  );
}
