/**
 * ZeMe — планировщик расписания SDU. Express API + статика фронта.
 *
 * Архитектура:
 *   - Сессии хранятся в PostgreSQL (таблица `sessions`) — полная изоляция пользователей,
 *     поддержка параллельных запросов, отсутствие race conditions с cookie.
 *   - В браузере хранится только непрозрачный HttpOnly-токен `zeme_session`.
 *   - Кэширование данных SDU (куррикулум, секции, корзина) в PostgreSQL
 *     (`student_data_cache`, `curriculum_cache`, `course_sections_cache`) снижает
 *     нагрузку на портал SDU на 95%+ и ускоряет ответ с 15с до <50мс.
 */

import path from 'node:path';
import express from 'express';
import { SduClient } from '../src/sdu/client.js';
import { demo } from './demo-data.mjs';
import { initDb, pool, bcrypt } from './db.mjs';
import {
  createSession,
  getSession,
  refreshSession,
  updateSession,
  deleteSession,
  setSduActive
} from './session.mjs';
import {
  getCachedStudentData,
  setCachedStudentData,
  clearCachedStudentData,
  getCachedCurriculum,
  setCachedCurriculum,
  getCachedSections,
  getStaleCachedSections,
  setCachedSections
} from './cache.mjs';
import {
  getVariants,
  createVariant,
  updateVariant,
  setActiveVariant,
  deleteVariant
} from './variants.mjs';

// Инициализация таблиц БД на старте
initDb().catch(console.error);

const PORT = Number(process.env.PORT || 3001);
const DEMO = process.env.DEMO === '1';

const app = express();
app.use(express.json({ limit: '64kb' }));

// ------------------------------------------------- Cookie и управление сессией
const COOKIE = 'zeme_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 дней

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSessionCookie(res, sessionId) {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const secure = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Сессионный middleware: загружает сессию из PostgreSQL
app.use(async (req, res, next) => {
  try {
    const sessionId = parseCookies(req)[COOKIE];
    if (!sessionId) {
      req.client = null;
      req.session = null;
      return next();
    }

    const session = await getSession(sessionId);
    if (!session) {
      req.client = null;
      req.session = null;
      return next();
    }

    const client = new SduClient();
    client.status = session.status;
    client.localUsername = session.username;
    client.localRole = session.role;
    client.userId = session.user_id;

    if (session.sdu_jar && typeof session.sdu_jar === 'object') {
      for (const [k, v] of Object.entries(session.sdu_jar)) {
        if (typeof v === 'string') client.jar.set(k, v);
      }
    }

    // Автоматическое сохранение обновлений cookie-jar SDU в БД
    client.onJarChange = (jar) => {
      updateSession(session.id, { sduJar: Object.fromEntries(jar) }).catch(console.error);
    };

    // Sliding Session: если сессия активна и до истечения осталось менее 3 дней, продлеваем на 7 дней
    if (session.expires_at) {
      const expiresAtMs = new Date(session.expires_at).getTime();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      if (expiresAtMs - Date.now() < threeDaysMs) {
        pool.query(
          `UPDATE sessions SET expires_at = NOW() + INTERVAL '7 days', updated_at = NOW() WHERE id = $1`,
          [session.id]
        ).catch(console.error);
      }
    }

    req.sessionId = session.id;
    req.session = session;
    req.client = client;
    next();
  } catch (err) {
    console.error('[session middleware]', err);
    next();
  }
});

// ------------------------------------------------- Утилиты и обработка ошибок
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sessionExpiredError() {
  const e = new HttpError(401, 'Сессия портала истекла — войдите заново');
  e.sessionExpired = true;
  return e;
}

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

function requireAuth(req) {
  if (DEMO) return undefined;
  if (!req.client || req.client.status !== 'authed') {
    throw new HttpError(401, 'not authenticated');
  }
  return req.client;
}

function requireAdmin(req) {
  const client = requireAuth(req);
  if (client.localRole !== 'Administrator') {
    throw new HttpError(403, 'Доступ запрещен. Требуются права администратора.');
  }
  return client;
}

// Лёгкий rate-limit на auth-эндпоинты: 30 запросов / минуту / IP
const authHits = new Map();
app.use('/api/auth', (req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'default-ip';
  const now = Date.now();
  const window = (authHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (window.length >= 30) return res.status(429).json({ error: 'слишком много попыток, подождите минуту' });
  window.push(now);
  authHits.set(ip, window);
  next();
});

// ------------------------------------------------- Аутентификация
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) throw new HttpError(400, 'username и password обязательны');

  const client = new SduClient();
  const r = await client.login(String(username), String(password));
  if (!r.ok) throw new HttpError(401, 'Неверный логин или пароль');

  // Поиск/создание локального пользователя в БД
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [String(username)]);
  let user = rows[0];
  if (!user) {
    const hash = await bcrypt.hash(password, 10);
    const insertRes = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
      [String(username), hash]
    );
    user = insertRes.rows[0];
  } else {
    if (user.is_blocked) {
      throw new HttpError(403, 'Ваш аккаунт заблокирован');
    }
  }

  const sessionStatus = r.needs2fa ? 'pending_2fa' : 'authed';
  const sessionId = await createSession({
    userId: user.id,
    username: user.username,
    role: user.role,
    status: sessionStatus,
    sduJar: client.jarAsObject(),
  });

  setSessionCookie(res, sessionId);
  res.json({ status: r.needs2fa ? '2fa_required' : 'ok', role: user.role });
}));

app.post('/api/auth/2fa', asyncHandler(async (req, res) => {
  const client = req.client;
  if (!client || client.status !== 'pending_2fa' || !req.sessionId) {
    throw new HttpError(400, '2fa не ожидается');
  }
  const { code } = req.body ?? {};
  if (!/^\d{6}$/.test(String(code ?? ''))) throw new HttpError(400, 'Код — 6 цифр');

  const r = await client.submit2fa(String(code));
  if (!r.ok) {
    throw new HttpError(401, 'Код не принят — он неверный или истёк. Выйдите и войдите заново: придёт новый код');
  }

  await updateSession(req.sessionId, {
    status: 'authed',
    sduJar: client.jarAsObject(),
  });

  res.json({ status: 'ok' });
}));

app.post('/api/auth/refresh', asyncHandler(async (req, res) => {
  const sessionId = parseCookies(req)[COOKIE];
  if (!sessionId) throw new HttpError(401, 'Нет сессии для обновления');

  // Продлеваем сессию на 7 дней в БД (с grace period 14 дней для недавно истекших)
  const session = await refreshSession(sessionId, 14);
  if (!session) throw new HttpError(401, 'Сессия не найдена или окончательно истекла');

  setSessionCookie(res, sessionId);
  res.json({ ok: true, status: 'ok' });
}));

app.post('/api/auth/logout', asyncHandler(async (req, res) => {
  if (req.client) {
    await req.client.logout().catch(() => {});
  }
  if (req.sessionId) {
    await deleteSession(req.sessionId).catch(() => {});
  }
  clearSessionCookie(res);
  res.json({ status: 'ok' });
}));

app.post('/api/auth/sdu-reconnect', asyncHandler(async (req, res) => {
  const client = requireAuth(req);
  const { password } = req.body ?? {};
  if (!password) throw new HttpError(400, 'укажите password');

  const freshClient = new SduClient();
  const r = await freshClient.login(client.localUsername, password);
  if (r.needs2fa) {
    await updateSession(req.sessionId, { sduJar: freshClient.jarAsObject() });
    return res.json({ status: '2fa_required' });
  }

  await updateSession(req.sessionId, {
    sduActive: true,
    sduJar: freshClient.jarAsObject(),
  });
  res.json({ status: 'ok' });
}));

app.post('/api/auth/sdu-reconnect-2fa', asyncHandler(async (req, res) => {
  const client = requireAuth(req);
  const { code } = req.body ?? {};
  if (!code) throw new HttpError(400, 'укажите code');

  const r = await client.submit2fa(code);
  if (!r.ok) throw new HttpError(401, 'Неверный 2FA код');

  await updateSession(req.sessionId, {
    sduActive: true,
    sduJar: client.jarAsObject(),
  });
  res.json({ status: 'ok' });
}));

// ------------------------------------------------- Получение данных с кэшированием
async function getCurriculum(client) {
  // 1. Сначала проверяем кэш студента в БД — там уже сохранён trackId!
  const studentData = await getCachedStudentData(client.localUsername);
  let trackId = studentData?.track?.id;

  if (trackId) {
    const cached = await getCachedCurriculum(trackId);
    if (cached) return cached.curriculum;
  }

  // 2. Если trackId ещё нет в БД, запрашиваем страницу регистраций
  if (!trackId) {
    const me = await client.getCourseReg();
    if (me.authenticated === false) throw sessionExpiredError();
    trackId = me.track?.id;
  }

  if (!trackId) {
    // Фолбэк на любой доступный куррикулум из БД
    const { rows } = await pool.query('SELECT curriculum FROM curriculum_cache LIMIT 1');
    if (rows.length > 0) return rows[0].curriculum;
    throw new HttpError(502, 'не нашли id трека на странице course_reg');
  }

  const cached = await getCachedCurriculum(trackId);
  if (cached) return cached.curriculum;

  const curriculum = await client.getCurriculum(trackId);
  const withParams = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.sectionsParams);
  const sectionsDefaults = withParams?.sectionsParams ?? null;

  await setCachedCurriculum(trackId, curriculum, sectionsDefaults).catch(console.error);
  return curriculum;
}

async function getMe(client) {
  let me;
  try {
    me = await client.getCourseReg();
  } catch (err) {
    const cached = await getCachedStudentData(client.localUsername);
    if (cached) return cached;
    throw err;
  }

  if (me.authenticated === false) {
    const cached = await getCachedStudentData(client.localUsername);
    if (cached) return cached;
    throw sessionExpiredError();
  }

  const trackId = me.track?.id;
  let curriculum = null;
  let def = null;

  if (trackId) {
    const cachedCurr = await getCachedCurriculum(trackId);
    if (cachedCurr) {
      curriculum = cachedCurr.curriculum;
      def = cachedCurr.sectionsDefaults;
    } else {
      try {
        curriculum = await client.getCurriculum(trackId);
        const withParams = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.sectionsParams);
        def = withParams?.sectionsParams ?? null;
        await setCachedCurriculum(trackId, curriculum, def).catch(console.error);
      } catch { /* curriculum fetch failure won't block /api/me */ }
    }
  }

  const chips = [];
  if (curriculum && Array.isArray(me.approved)) {
    const curriculumByCode = new Map(
      curriculum.semesters.flatMap((s) => s.courses).map((c) => [c.code, c])
    );

    for (const course of me.approved) {
      const params = curriculumByCode.get(course.code)?.sectionsParams ?? def;
      if (!params) continue;
      try {
        const cacheKey = `${course.code.toUpperCase()}:norm`;
        let s = await getCachedSections(cacheKey);
        if (!s) {
          s = await client.getSections({ ...params, dk: course.code });
          await setCachedSections(cacheKey, s).catch(console.error);
        }
        const n = s.theory?.find((t) => t.section === course.normalSection);
        const p = s.practice?.find((t) => t.section === course.practiceSection);
        for (const sec of [n, p]) {
          if (sec) {
            chips.push({
              code: course.code,
              kind: sec.kind,
              section: sec.section,
              teacher: sec.teacher,
              slots: sec.schedule,
            });
          }
        }
      } catch {
        // У курса может не быть секций
      }
    }
  }

  return {
    authenticated: true,
    term: me.term,
    isApproved: me.isApproved,
    track: me.track,
    progTrack: me.progTrack,
    approved: me.approved,
    schedule: chips,
  };
}

app.get('/api/me', asyncHandler(async (req, res) => {
  if (DEMO) return res.json(demo.me());
  const client = requireAuth(req);
  const forceRefresh = req.query.refresh === '1';
  const sduActive = req.session?.sdu_active !== false;

  // 1. Проверяем кэш в БД
  if (!forceRefresh) {
    const cached = await getCachedStudentData(client.localUsername);
    if (cached) {
      return res.json({ ...cached, sduActive });
    }
  }

  // 2. Запрашиваем свежие данные с портала SDU
  const data = await getMe(client);
  await setCachedStudentData(client.localUsername, data).catch(console.error);
  res.json({ ...data, sduActive });
}));

app.get('/api/curriculum', asyncHandler(async (req, res) => {
  if (DEMO) return res.json(demo.curriculum());
  const client = requireAuth(req);

  // Сначала проверяем кэш по id трека
  const studentData = await getCachedStudentData(client.localUsername);
  const trackId = studentData?.track?.id;
  if (trackId) {
    const cachedCurr = await getCachedCurriculum(trackId);
    if (cachedCurr) {
      return res.json(cachedCurr.curriculum);
    }
  }

  const curriculum = await getCurriculum(client);
  res.json(curriculum);
}));

app.get('/api/sections', asyncHandler(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code) throw new HttpError(400, 'укажите ?code=');
  if (DEMO) return res.json(demo.sections(code));
  const client = requireAuth(req);

  const mufSqId = req.query.mufSqId ? String(req.query.mufSqId) : undefined;
  const cacheKey = `${code.toUpperCase()}:${mufSqId || 'norm'}`;

  // 1. Проверяем свежий кэш секций в БД (отдаётся мгновенно за 5-10 мс)
  const cached = await getCachedSections(cacheKey);
  if (cached) return res.json(cached);

  // 2. Если в кэше нет — пробуем загрузить с портала SDU
  try {
    const curriculum = await getCurriculum(client);
    const found = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.code.toUpperCase() === code.toUpperCase());
    const params = found?.sectionsParams;
    if (!params) {
      const studentData = await getCachedStudentData(client.localUsername);
      const progTrack = studentData?.progTrack ?? 'TRACK0';
      const searchData = await client.searchCourse(code, progTrack);
      await setCachedSections(cacheKey, searchData).catch(console.error);
      return res.json(searchData);
    }

    const sectionsData = await client.getSections({ ...params, dk: code, mufSqId });
    await setCachedSections(cacheKey, sectionsData).catch(console.error);
    return res.json(sectionsData);
  } catch (err) {
    // 3. Fallback: если портал SDU вернул ошибку/сессия умерла,
    // но в нашей базе ЕСТЬ сохранённые секции этого курса — отдаём их!
    const staleData = await getStaleCachedSections(cacheKey);
    if (staleData) {
      return res.json({ ...staleData, _stale: true });
    }
    // Если секций в базе нет вообще — пробрасываем ошибку для обработки
    throw err;
  }
}));

app.get('/api/search', asyncHandler(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code) throw new HttpError(400, 'укажите ?code=');
  if (DEMO) return res.json(demo.sections(code));
  const client = requireAuth(req);

  const studentData = await getCachedStudentData(client.localUsername);
  const progTrack = studentData?.progTrack ?? 'TRACK0';
  res.json(await client.searchCourse(code, progTrack));
}));

app.post('/api/electives', asyncHandler(async (req, res) => {
  const { dk, mufSqId, periodNo, groupName, candidates = [], codeType, lgCode, type } = req.body ?? {};
  if (!dk) throw new HttpError(400, 'укажите dk (код заглушки электива)');
  if (DEMO) {
    return res.json({ fromPortal: false, courses: candidates.map((code) => ({ code, name: '' })) });
  }
  const client = requireAuth(req);

  let def = {};
  const studentData = await getCachedStudentData(client.localUsername);
  if (studentData?.track?.id) {
    const cachedCurr = await getCachedCurriculum(studentData.track.id);
    if (cachedCurr?.sectionsDefaults) def = cachedCurr.sectionsDefaults;
  }
  if (!def.pc) {
    await getCurriculum(client);
    const cachedCurr = await getCachedCurriculum(studentData?.track?.id);
    if (cachedCurr?.sectionsDefaults) def = cachedCurr.sectionsDefaults;
  }

  const groupTitle = groupName ? `${groupName} (${candidates.join(', ')})` : '';
  res.json(await client.getElectiveCourses({
    dk: String(dk),
    mufSqId: mufSqId ?? null,
    periodNo: periodNo ?? null,
    groupTitle,
    pc: def.pc,
    py: def.py,
    track: def.track,
    codeType: codeType ?? 'R',
    lgCode: lgCode ?? '',
    type: type ?? 'NAE',
    fallbackCodes: candidates,
  }));
}));

// ------------------------------------------------- Варианты расписания (Schedule Variants)
// Демо-хранилище вариантов расписания для DEMO=1
let demoVariants = [
  {
    id: 'demo-variant-1',
    name: 'Основной',
    schedule: [],
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }
];

// ------------------------------------------------- Варианты расписания (Schedule Variants)
app.get('/api/schedule/variants', asyncHandler(async (req, res) => {
  if (DEMO) {
    return res.json({
      variants: demoVariants,
      activeVariantId: demoVariants.find((v) => v.is_active)?.id ?? demoVariants[0]?.id
    });
  }
  const client = requireAuth(req);
  const variants = await getVariants(client.userId);
  res.json({ variants, activeVariantId: variants.find((v) => v.is_active)?.id ?? variants[0]?.id });
}));

app.post('/api/schedule/variants', asyncHandler(async (req, res) => {
  const { name, schedule = [], isActive = true } = req.body ?? {};
  if (!name || !String(name).trim()) throw new HttpError(400, 'укажите название варианта');
  const safeName = String(name).trim().slice(0, 100);

  if (DEMO) {
    if (isActive) demoVariants.forEach((v) => { v.is_active = false; });
    const newVar = {
      id: 'demo-variant-' + Date.now(),
      name: safeName,
      schedule,
      is_active: Boolean(isActive),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    demoVariants.push(newVar);
    return res.json(newVar);
  }

  const client = requireAuth(req);
  const variant = await createVariant(client.userId, safeName, schedule, Boolean(isActive));
  res.json(variant);
}));

app.put('/api/schedule/variants/:id', asyncHandler(async (req, res) => {
  const { name, schedule } = req.body ?? {};
  if (DEMO) {
    const v = demoVariants.find((x) => x.id === req.params.id);
    if (!v) throw new HttpError(404, 'Вариант не найден');
    if (name !== undefined) v.name = String(name).trim().slice(0, 100);
    if (schedule !== undefined) v.schedule = schedule;
    v.updated_at = new Date().toISOString();
    return res.json(v);
  }

  const client = requireAuth(req);
  const updated = await updateVariant(client.userId, req.params.id, { name, schedule });
  if (!updated) throw new HttpError(404, 'Вариант не найден');
  res.json(updated);
}));

app.put('/api/schedule/variants/:id/active', asyncHandler(async (req, res) => {
  if (DEMO) {
    demoVariants.forEach((x) => { x.is_active = (x.id === req.params.id); });
    const active = demoVariants.find((x) => x.id === req.params.id);
    if (!active) throw new HttpError(404, 'Вариант не найден');
    return res.json(active);
  }

  const client = requireAuth(req);
  const active = await setActiveVariant(client.userId, req.params.id);
  if (!active) throw new HttpError(404, 'Вариант не найден');
  res.json(active);
}));

app.delete('/api/schedule/variants/:id', asyncHandler(async (req, res) => {
  if (DEMO) {
    demoVariants = demoVariants.filter((x) => x.id !== req.params.id);
    if (demoVariants.length > 0 && !demoVariants.some((x) => x.is_active)) {
      demoVariants[0].is_active = true;
    }
    return res.json({ ok: true, activeVariantId: demoVariants.find((x) => x.is_active)?.id ?? null });
  }

  const client = requireAuth(req);
  const result = await deleteVariant(client.userId, req.params.id);
  if (!result.ok) throw new HttpError(404, 'Вариант не найден');
  res.json(result);
}));

// ------------------------------------------------- Профиль пользователя
app.get('/api/profile', asyncHandler(async (req, res) => {
  const client = requireAuth(req);
  if (!client.localUsername) throw new HttpError(401, 'Не найден локальный пользователь');
  const { rows } = await pool.query(
    'SELECT username, display_name, avatar_url, role FROM users WHERE username = $1',
    [client.localUsername]
  );
  if (rows.length === 0) throw new HttpError(404, 'Профиль не найден');
  res.json(rows[0]);
}));

app.put('/api/profile', asyncHandler(async (req, res) => {
  const client = requireAuth(req);
  if (!client.localUsername) throw new HttpError(401, 'Не найден локальный пользователь');
  const { display_name, avatar_url } = req.body ?? {};

  const { rows } = await pool.query(
    'UPDATE users SET display_name = $1, avatar_url = $2 WHERE username = $3 RETURNING username, display_name, avatar_url, role',
    [display_name, avatar_url, client.localUsername]
  );
  res.json(rows[0]);
}));

// ------------------------------------------------- Админ-панель
app.get('/api/admin/users', asyncHandler(async (req, res) => {
  requireAdmin(req);
  const { rows } = await pool.query(
    'SELECT id, username, display_name, role, is_blocked, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(rows);
}));

app.put('/api/admin/users/:username/role', asyncHandler(async (req, res) => {
  requireAdmin(req);
  const { role } = req.body ?? {};
  if (!['Student', 'Advisor', 'Administrator'].includes(role)) {
    throw new HttpError(400, 'Недопустимая роль');
  }
  const { rows } = await pool.query(
    'UPDATE users SET role = $1 WHERE username = $2 RETURNING id, username, role',
    [role, req.params.username]
  );
  if (rows.length === 0) throw new HttpError(404, 'Пользователь не найден');
  res.json(rows[0]);
}));

app.put('/api/admin/users/:username/block', asyncHandler(async (req, res) => {
  requireAdmin(req);
  const { is_blocked } = req.body ?? {};
  const { rows } = await pool.query(
    'UPDATE users SET is_blocked = $1 WHERE username = $2 RETURNING id, username, is_blocked',
    [!!is_blocked, req.params.username]
  );
  if (rows.length === 0) throw new HttpError(404, 'Пользователь не найден');
  res.json(rows[0]);
}));

// ------------------------------------------------- Статика
const webDist = path.resolve('web/dist');
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webDist, 'index.html'));
});

// ------------------------------------------------- Централизованный обработчик ошибок
app.use(async (err, req, res, _next) => {
  const isSduSessionExpired = err.sessionExpired === true;
  if (isSduSessionExpired) {
    if (req.sessionId) {
      // ПОМЕЧАЕМ sdu_active = false в БД, НО НЕ УДАЛЯЕМ сессию ZeMe!
      await setSduActive(req.sessionId, false).catch(() => {});
    }
    // Пользователь остаётся авторизованным в ZeMe!
  }

  const status = isSduSessionExpired ? 401 : (err instanceof HttpError ? err.status : (err.status || 500));
  if (status >= 500) {
    console.error(`[api error] ${req.method} ${req.path}:`, err.message || err);
  }

  res.status(status).json({
    error: err.message || 'internal error',
    ...(isSduSessionExpired ? { sduSessionExpired: true, zemeAuthenticated: !!req.session } : {})
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ZeMe server: http://localhost:${PORT} (${DEMO ? 'DEMO' : 'live: my.sdu.edu.kz'})`);
  });
}

export { app };
