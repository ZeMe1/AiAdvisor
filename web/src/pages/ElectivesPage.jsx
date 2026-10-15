import React, { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import Basket from '../components/Basket.jsx';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

export default function ElectivesPage() {
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const { me, handleAuthError } = useAuthStore();
  const course = location.state?.course;

  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    async function fetchElectives() {
      if (!course?.elective) {
        setList([]);
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
          candidates: el.candidateCodes,
          codeType: el.codeType,
          lgCode: el.lgCode,
          type: el.type,
        });
        if (isMounted) {
          setList(res.courses ?? []);
        }
      } catch (err) {
        if (!handleAuthError(err) && isMounted) {
          setError(err.message);
          toast.warn('Не удалось загрузить курсы с портала: ' + err.message);
          // Фолбэк на коды из программы
          setList(course.elective.candidateCodes.map((c) => ({ code: c, name: '' })));
        }
      } finally {
        if (isMounted) setBusy(false);
      }
    }

    fetchElectives();
    return () => { isMounted = false; };
  }, [course, handleAuthError, toast]);

  const groupName = course?.elective?.groupName || course?.name || code;
  const mufSqId = course?.elective?.mufSqId;

  const handleChoose = (c) => {
    const targetMufSqId = c.sectionsParams?.mufSqId ?? mufSqId;
    navigate(`/courses/${encodeURIComponent(c.code)}${targetMufSqId ? `?mufSqId=${encodeURIComponent(targetMufSqId)}` : ''}`);
  };

  return (
    <main className="page">
      <div className="course-topline">
        <button className="btn" onClick={() => navigate('/')}>← К списку курсов</button>
        <h2 className="course-title">
          Электив — {groupName}
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
                  <button className="btn" onClick={() => handleChoose(c)}>Choose</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
