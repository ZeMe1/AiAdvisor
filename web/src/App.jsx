import React, { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { slotIndexOf, markConflicts } from './schedule.js';
import Login from './components/Login.jsx';
import TwoFa from './components/TwoFa.jsx';
import Basket from './components/Basket.jsx';
import Curriculum from './components/Curriculum.jsx';
import CoursePage from './components/CoursePage.jsx';
import ElectivesPage from './components/ElectivesPage.jsx';
import ProfilePage from './components/ProfilePage.jsx';
import AdminPanel from './components/AdminPanel.jsx';

const PLAN_KEY = 'zeme_plan_v1';
const loadPlan = () => {
  try { return JSON.parse(localStorage.getItem(PLAN_KEY)) ?? []; } catch { return []; }
};
const timeStr = (sec) => (sec?.schedule ?? []).map((s) => `${s.day}.${s.time}`).join(', ');
const NULL_DRAFT = { N: null, P: null, L: null };

export default function App() {
  const [stage, setStage] = useState('boot'); // boot | login | 2fa | main
  const [view, setView] = useState('home'); // home | course | electives
  const [me, setMe] = useState(null);
  const [profile, setProfile] = useState(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [curriculum, setCurriculum] = useState(null);
  const [plan, setPlan] = useState(loadPlan);
  const [open, setOpen] = useState(null); // { code, name, data } — курс на странице курса
  const [draft, setDraft] = useState(NULL_DRAFT);
  const [elective, setElective] = useState(null); // заглушка XXX, открытая юзером
  const [electiveList, setElectiveList] = useState(null); // { fromPortal, courses }
  const [electiveBusy, setElectiveBusy] = useState(false);
  const [electiveError, setElectiveError] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loginNotice, setLoginNotice] = useState(null);

  useEffect(() => {
    api.me().then((m) => { 
      setMe(m); 
      setStage('main'); 
      if (!m.demo) api.profile().then(setProfile).catch(console.error);
    }).catch(() => setStage('login'));
  }, []);

  useEffect(() => {
    if (stage !== 'main') return;
    api.curriculum().then(setCurriculum).catch((e) => {
      if (authFail(e)) return;
      setError(e.message);
    });
  }, [stage]);

  useEffect(() => { localStorage.setItem(PLAN_KEY, JSON.stringify(plan)); }, [plan]);

  async function loadMain() {
    const m = await api.me();
    setMe(m);
    setStage('main');
    api.curriculum().then(setCurriculum).catch((e) => setError(e.message));
    if (!m.demo) {
      api.profile().then(setProfile).catch(console.error);
    }
  }

  async function handleLogin(username, password) {
    const r = await api.login(username, password);
    if (r.status === '2fa_required') { setStage('2fa'); return; }
    await loadMain();
  }

  async function handle2fa(code) {
    await api.twoFa(code);
    await loadMain();
  }

  async function openCourse(code, mufSqId) {
    setBusy(true);
    setError(null);
    try {
      const data = await api.sections(code, mufSqId);
      const courseCode = data.course.code ?? code;
      setOpen({ code: courseCode, name: data.course.name, data });
      const existing = plan.find((p) => p.code === courseCode);
      setDraft({
        N: existing?.theoryId ?? null,
        P: existing?.practiceId ?? null,
        L: null,
      });
      setView('course');
      window.scrollTo(0, 0);
    } catch (e) {
      if (authFail(e)) return;
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** 401 от нашего API — сессия портала истекла, отправляем на логин. */
  function authFail(e) {
    if (e?.status !== 401) return false;
    setStage('login');
    setLoginNotice('Сессия портала истекла — войдите заново, придёт новый код 2FA');
    return true;
  }

  function backToHome() {
    setView('home');
    setOpen(null);
    setDraft(NULL_DRAFT);
    setElective(null);
    setElectiveList(null);
    setElectiveError(null);
    window.scrollTo(0, 0);
  }

  /** Choose из куррикулума: электив -> страница группы, обычный курс -> лекции. */
  function handleChoose(course) {
    if (course.isElective && course.elective) {
      openElectives(course);
    } else {
      openCourse(course.code, course.sectionsParams?.mufSqId);
    }
  }

  async function openElectives(course) {
    setElective(course);
    setElectiveList(null);
    setElectiveError(null);
    setElectiveBusy(true);
    setView('electives');
    window.scrollTo(0, 0);
    try {
      const el = course.elective;
      const r = await api.electives({
        dk: course.code,
        mufSqId: el.mufSqId,
        periodNo: el.periodNo,
        groupName: el.groupName,
        candidates: el.candidateCodes,
        codeType: el.codeType,
        lgCode: el.lgCode,
        type: el.type,
      });
      setElectiveList(r);
    } catch (e) {
      if (authFail(e)) return;
      // портал не ответил — всё равно показываем коды из программы
      setElectiveList({ fromPortal: false, courses: course.elective.candidateCodes.map((code) => ({ code, name: '' })) });
      setElectiveError(e.message);
    } finally {
      setElectiveBusy(false);
    }
  }

  function addToPlan({ theory, practice, lab }) {
    const entry = {
      code: open.code, name: open.name,
      theoryId: theory.id, practiceId: practice?.id ?? null, labId: lab?.id ?? null,
      theory: { section: theory.section, teacher: theory.teacher, schedule: theory.schedule },
      practice: practice ? { section: practice.section, teacher: practice.teacher, schedule: practice.schedule } : null,
      lab: lab ? { section: lab.section, teacher: lab.teacher, schedule: lab.schedule } : null,
    };
    setPlan((prev) => [...prev.filter((p) => p.code !== open.code), entry]);
    backToHome();
  }

  // ---- чипы сетки: корзина + план + ТОЛЬКО кликнутые секции открытого курса
  const chips = useMemo(() => {
    const list = [];
    for (const c of me?.schedule ?? []) {
      const label = `${c.code} [${c.section}-${c.kind}]`;
      for (const s of c.slots ?? []) {
        list.push({ code: c.code, kind: c.kind, teacher: c.teacher, label, color: 'basket', day: s.day - 1, row: slotIndexOf(s.time) });
      }
    }
    for (const p of plan) {
      for (const [kind, sec] of [['N', p.theory], ['P', p.practice], ['L', p.lab]]) {
        if (!sec) continue;
        const label = `${p.code} [${sec.section}-${kind}]`;
        for (const s of sec.schedule ?? []) {
          list.push({ code: p.code, kind, teacher: sec.teacher, label, color: 'sel', day: s.day - 1, row: slotIndexOf(s.time) });
        }
      }
    }
    if (view === 'course' && open) {
      const entry = plan.find((p) => p.code === open.code);
      const groups = [
        ['N', open.data.theory, draft.N, entry?.theoryId],
        ['P', open.data.practice, draft.P, entry?.practiceId],
        ['L', open.data.lab ?? [], draft.L, entry?.labId],
      ];
      for (const [kind, arr, draftId, planId] of groups) {
        // если выбранная секция уже добавлена в план — её чип уже есть из плана
        if (!draftId || draftId === planId) continue;
        const sec = arr.find((s) => s.id === draftId);
        if (!sec) continue;
        const label = `${open.code.replace(' ', '')} [${sec.section}-${kind}]`;
        for (const slot of sec.schedule ?? []) {
          list.push({ code: open.code, kind, teacher: sec.teacher, label, color: 'sel', day: slot.day - 1, row: slotIndexOf(slot.time) });
        }
      }
    }
    return markConflicts(list);
  }, [me, plan, open, draft, view]);

  const conflictOnCourse = chips.some((c) => c.conflict && c.color === 'sel');

  if (stage === 'boot') return <div className="boot">Загрузка…</div>;
  if (stage === 'login') return <Login onLogin={handleLogin} notice={loginNotice} />;
  if (stage === '2fa') return <TwoFa onSubmit={handle2fa} />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">ZeMe <span className="brand-sub">· SDU schedule planner</span></span>
        <span className="topbar-info">
          {me.term && <b>{me.term}</b>}
          {me.user?.name && <span>{me.user.name} · {me.user.program}</span>}
          {me.demo && <span className="demo-badge">demo data</span>}
        </span>
        <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {profile?.role === 'Administrator' && (
            <button className="btn" onClick={() => { setView('admin'); window.scrollTo(0,0); }}>
              Admin Panel
            </button>
          )}
          {profile && (
            <div 
              className="profile-btn" 
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }} 
              onClick={() => { setView('profile'); window.scrollTo(0,0); }}
            >
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="Avatar" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#0052cc', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {profile.display_name ? profile.display_name[0].toUpperCase() : profile.username[0].toUpperCase()}
                </div>
              )}
              <span>{profile.display_name || profile.username}</span>
            </div>
          )}
          <button className="btn btn-ghost" onClick={async () => { await api.logout(); location.reload(); }}>
            Sign out
          </button>
        </div>
      </header>

      {error && <div className="banner-error" onClick={() => setError(null)}>{error} ✕</div>}

      {view === 'admin' && profile?.role === 'Administrator' ? (
        <main className="page">
          <AdminPanel onBack={backToHome} />
        </main>
      ) : view === 'profile' && profile ? (
        <main className="page">
          <ProfilePage 
            profile={profile}
            onSave={async (data) => {
              const updated = await api.updateProfile(data);
              setProfile(updated);
            }}
            onBack={backToHome}
          />
        </main>
      ) : view === 'course' && open ? (
        <main className="page">
          <CoursePage
            me={me} open={open} draft={draft} setDraft={setDraft}
            chips={chips} conflict={conflictOnCourse}
            onAdd={addToPlan} onBack={backToHome}
          />
        </main>
      ) : view === 'electives' && elective ? (
        <main className="page">
          <ElectivesPage
            me={me}
            group={{ code: elective.code, name: elective.name }}
            list={electiveList?.courses ?? elective.elective.candidateCodes.map((code) => ({ code, name: '' }))}
            busy={electiveBusy}
            error={electiveError}
            onChoose={(c) => openCourse(c.code, c.sectionsParams?.mufSqId ?? elective.elective?.mufSqId)}
            onBack={backToHome}
          />
        </main>
      ) : (
        <main className="page">
          <section className="card search-card">
            <h2>Use one of three ways to pick a course</h2>
            <div className="search-row">
              <input
                value={search}
                placeholder="Search by course code, e.g. CSS 410"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search.trim() && openCourse(search.trim())}
              />
              <button className="btn btn-primary" disabled={!search.trim() || busy} onClick={() => openCourse(search.trim())}>
                {busy ? '…' : 'Search'}
              </button>
            </div>
            <p className="muted small">1 — поиск по коду · 2 — Choose в куррикулуме ниже · 3 — коды кандидатов у элективов</p>
          </section>

          <Basket me={me} />

          <section className="card">
            <h2>📝 Мой план <span className="muted small">(хранится локально, в SDU не отправляется)</span></h2>
            {plan.length === 0 && <p className="muted">Пусто — выберите секции курса через Choose или поиск.</p>}
            {plan.map((p) => (
              <div className="plan-row" key={p.code}>
                <div>
                  <b className="code">{p.code}</b> {p.name}
                  <div className="small muted">
                    N {p.theory.section} ({p.theory.teacher}) {timeStr(p.theory)}
                    {p.practice && <> · P {p.practice.section} ({p.practice.teacher}) {timeStr(p.practice)}</>}
                  </div>
                </div>
                <button className="btn btn-mini" onClick={() => setPlan((prev) => prev.filter((x) => x.code !== p.code))}>drop</button>
              </div>
            ))}
            {plan.length > 0 && chips.some((c) => c.conflict) && (
              <div className="banner-warn">
                ⚠ Есть пересечения по времени между курсами плана и/или корзиной — открой курс, чтобы увидеть детали на сетке.
              </div>
            )}
          </section>

          {curriculum
            ? <Curriculum curriculum={curriculum} onChoose={handleChoose} />
            : <section className="card"><p className="muted">Куррикулум загружается…</p></section>}
        </main>
      )}
    </div>
  );
}
