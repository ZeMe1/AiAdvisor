import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import Basket from '../components/Basket.jsx';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useScheduleStore } from '../stores/scheduleStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

export default function ElectivesPage() {
  const { code } = useParams();
  const [searchParams] = useSearchParams();
  const mufSqIdParam = searchParams.get('mufSqId');
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const { me } = useAuthStore();
  const { curriculum, loadCurriculum } = useScheduleStore();

  useEffect(() => {
    if (!curriculum) {
      loadCurriculum().catch(console.error);
    }
  }, [curriculum, loadCurriculum]);

  // Восстанавливаем курс из state или ищем в куррикулуме
  const course = useMemo(() => {
    if (location.state?.course) return location.state.course;
    if (!curriculum?.semesters) return null;
    const allCourses = curriculum.semesters.flatMap((s) => s.courses);
    if (mufSqIdParam) {
      const match = allCourses.find((c) => String(c.elective?.mufSqId) === String(mufSqIdParam));
      if (match) return match;
    }
    return allCourses.find((c) => c.code.toUpperCase() === code?.toUpperCase());
  }, [location.state?.course, curriculum, mufSqIdParam, code]);

  const candidateCodes = useMemo(() => {
    return (course?.elective?.candidateCodes ?? [])
      .flatMap((c) => String(c).split(/[,/]/))
      .map((s) => s.trim())
      .filter(Boolean);
  }, [course]);

  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchElectives() {
      if (!course?.elective) {
        if (candidateCodes.length > 0) {
          setList(candidateCodes.map((c) => ({ code: c, name: '' })));
        } else {
          setList([]);
        }
        return;
      }

      setBusy(true);
      setError(null);
      try {
        const el = course.elective;
        const res = await api.electives({
          dk: course.code,
          mufSqId: el.mufSqId,
          periodNo: el.periodNo,
          groupName: el.groupName,
          candidates: candidateCodes,
          codeType: el.codeType,
          lgCode: el.lgCode,
          type: el.type,
        });
        if (isMounted) {
          if (res?.courses?.length > 0) {
            setList(res.courses);
          } else {
            // Фолбэк на коды из программы
            setList(candidateCodes.map((c) => ({ code: c, name: '' })));
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message);
          toast.warn('Could not load courses from portal — displaying program codes');
          // Никогда не разлогиниваем пользователя на ошибке элективов
          setList(candidateCodes.map((c) => ({ code: c, name: '' })));
        }
      } finally {
        if (isMounted) setBusy(false);
      }
    }

    fetchElectives();
    return () => { isMounted = false; };
  }, [course, candidateCodes, toast]);

  const groupName = course?.elective?.groupName || course?.name || code;
  const mufSqId = course?.elective?.mufSqId || mufSqIdParam;

  const handleChoose = (c) => {
    const targetMufSqId = c.sectionsParams?.mufSqId ?? mufSqId;
    navigate(`/courses/${encodeURIComponent(c.code)}${targetMufSqId ? `?mufSqId=${encodeURIComponent(targetMufSqId)}` : ''}`);
  };

  return (
    <main className="page">
      <div className="course-topline">
        <button className="btn" onClick={() => navigate('/')}>← Back to courses</button>
        <h2 className="course-title">
          Elective — {groupName}
          <span className="muted"> · choose course from group</span>
        </h2>
      </div>

      <Basket me={me} />

      <section className="card">
        <h2>Available courses ({list.length})</h2>
        {busy && <p className="muted">Loading course list from portal…</p>}
        {!busy && error && (
          <p className="banner-warn">Could not fetch list from portal ({error}) — showing codes from your program.</p>
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
                <td>{c.name || <span className="muted small">course title will be fetched upon selection</span>}</td>
                <td className="c">{c.credits ?? '—'}</td>
                <td className="c">{c.ects ?? '—'}</td>
                <td className="c">
                  <button className="btn" onClick={() => handleChoose(c)}>Choose</button>
                </td>
              </tr>
            ))}
            {list.length === 0 && !busy && (
              <tr>
                <td colSpan={6} className="dim c" style={{ padding: '2rem' }}>
                  No courses found for this group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
