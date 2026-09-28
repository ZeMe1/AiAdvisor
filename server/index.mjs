/**
 * ZeMe — планировщик расписания SDU. Express API + статика фронта.
 *
 * Запуск:
 *   node server/index.mjs              — боевой режим (прокси на my.sdu.edu.kz)
 *   DEMO=1 node server/index.mjs       — демо на данных дампов (без логина)
 *
 * Работает и локально, и на Vercel (serverless): состояние сессии SDU
 * (статус + cookie-jar портала) хранится не в памяти процесса, а в
 * подписанной HMAC HttpOnly-куке zeme_sdu. Пароли не храним и не логируем.
 * Разобранный куррикулум кэшируется в памяти по PHPSESSID — это только
 * ускорение: на холодном инстансе данные просто тянутся с портала заново.
 */

import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import { SduClient } from '../src/sdu/client.js';
import { demo } from './demo-data.mjs';
import { initDb, pool, bcrypt } from './db.mjs';

// Initialize DB on startup (CREATE TABLE IF NOT EXISTS — safe to run repeatedly)
initDb().catch(console.error);


const PORT = Number(process.env.PORT || 3001);
const DEMO = process.env.DEMO === '1';

const app = express();
app.use(express.json({ limit: '64kb' }));

// ------------------------------------------------- сессия в подписанной куке
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'zeme_sdu';
const COOKIE_MAX_AGE = 24 * 60 * 60; // 24 часа

const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

function packSession(client) {
  const payload = Buffer.from(JSON.stringify({ 
    s: client.status, 
    c: Object.fromEntries(client.jar),
    lu: client.localUsername,
    lr: client.localRole
  }))
    .toString('base64url');
  return `v1.${payload}.${sign(payload)}`;
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function unpackSession(req) {
  const raw = parseCookies(req)[COOKIE];
  if (!raw) return null;
  const [v, payload, sig] = raw.split('.');
  if (v !== 'v1' || !payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { s, c, lu, lr } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const client = new SduClient();
    client.status = s === 'pending_2fa' || s === 'authed' ? s : 'anonymous';
    client.localUsername = lu;
    client.localRole = lr;
    for (const [k, val] of Object.entries(c ?? {})) {
      if (typeof val === 'string') client.jar.set(k, val);
    }
    return client;
  } catch {
    return null;
  }
}

function setSessionCookie(res, client) {
  res.setHeader('Set-Cookie', `${COOKIE}=${packSession(client)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

app.use((req, _res, next) => {
  req.client = unpackSession(req);
  next();
});

// Кэш разобранных данных по PHPSESSID: переживает запросы, но не обязателен.
const sessionCaches = new Map(); // PHPSESSID -> { curriculum, me, sectionsDefaults, basketSchedule }

function cacheFor(client) {
  const key = client.jar.get('PHPSESSID') ?? 'anon';
  let cache = sessionCaches.get(key);
  if (!cache) {
    cache = {};
    sessionCaches.set(key, cache);
    if (sessionCaches.size > 500) {
      sessionCaches.delete(sessionCaches.keys().next().value);
    }
  }
  return cache;
}

// ------------------------------------------------------------------ мелочи
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const expired = e.sessionExpired === true;
    if (expired) clearSessionCookie(res);
    const status = expired ? 401 : (e instanceof HttpError ? e.status : 502);
    if (status >= 500) console.error(`[api] ${req.method} ${req.path}:`, e.message);
    res.status(status).json({ error: e.message || 'internal error', ...(expired ? { sessionExpired: true } : {}) });
  }
};

function sessionExpiredError() {
  const e = new HttpError(401, 'Сессия портала истекла — войдите заново');
  e.sessionExpired = true;
  return e;
}

function requireAuth(req) {
  if (DEMO) return undefined;
  if (!req.client || req.client.status !== 'authed') {
    throw new HttpError(401, 'not authenticated');
  }
  return req.client;
}

// Лёгкий rate-limit на auth-эндпоинты: 12 запросов / минуту / IP.
// В serverless он пер-instance: на холодном инстансе счётчик обнуляется.
const authHits = new Map();
app.use('/api/auth', (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const window = (authHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (window.length >= 12) return res.status(429).json({ error: 'too many attempts, try later' });
  window.push(now);
  authHits.set(ip, window);
  next();
});

// ------------------------------------------------------------------ auth
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) throw new HttpError(400, 'username и password обязательны');
  const client = req.client && req.client.status === 'pending_2fa' ? req.client : new SduClient();
  const r = await client.login(String(username), String(password));
  if (!r.ok) throw new HttpError(401, 'Неверный логин или пароль');

  // DB Logic
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  let user = rows[0];
  if (!user) {
    const hash = await bcrypt.hash(password, 10);
    const insertRes = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *',
      [username, hash]
    );
    user = insertRes.rows[0];
  } else {
    if (user.is_blocked) {
      throw new HttpError(403, 'Ваш аккаунт заблокирован');
    }
    // Update password hash if needed, but not strictly necessary now.
  }
  // Attach local username to client so it gets packed into session cookie
  client.localUsername = user.username;
  client.localRole = user.role;

  setSessionCookie(res, client);
  res.json({ status: r.needs2fa ? '2fa_required' : 'ok', role: user.role });
}));

app.post('/api/auth/2fa', wrap(async (req, res) => {
  const client = req.client;
  if (!client || client.status !== 'pending_2fa') throw new HttpError(400, '2fa не ожидается');
  const { code } = req.body ?? {};
  if (!/^\d{6}$/.test(String(code ?? ''))) throw new HttpError(400, 'Код — 6 цифр');
  const r = await client.submit2fa(String(code));
  if (!r.ok) throw new HttpError(401, 'Код не принят — он неверный или истёк. Выйдите и войдите заново: придёт новый код');
  setSessionCookie(res, client);
  res.json({ status: 'ok' });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  clearSessionCookie(res);
  res.json({ status: 'ok' });
}));

// ------------------------------------------------------------------ данные
/** Параметры секций (pc/py/track) из куррикулума, кэшируется в сессии. */
async function getCurriculum(client, cache) {
  if (cache.curriculum) return cache.curriculum;
  const me = await client.getCourseReg();
  if (me.authenticated === false) throw sessionExpiredError();
  const trackId = me.track?.id;
  if (!trackId) throw new HttpError(502, 'не нашли id трека на странице course_reg');
  const curriculum = await client.getCurriculum(trackId);
  cache.curriculum = curriculum;
  cache.me = me;
  const withParams = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.sectionsParams);
  cache.sectionsDefaults = withParams?.sectionsParams ?? null;
  return curriculum;
}

async function getMe(client, cache) {
  if (!cache.me) {
    cache.me = await client.getCourseReg();
  }
  const me = cache.me;
  if (me.authenticated === false) throw sessionExpiredError();
  if (!cache.basketSchedule) {
    const curriculum = await getCurriculum(client, cache);
    const def = cache.sectionsDefaults;
    const curriculumByCode = new Map(
      curriculum.semesters.flatMap((s) => s.courses).map((c) => [c.code, c]),
    );
    const chips = [];
    for (const course of me.approved) {
      const params = curriculumByCode.get(course.code)?.sectionsParams ?? def;
      if (!params) continue;
      try {
        const s = await client.getSections({ ...params, dk: course.code });
        const n = s.theory.find((t) => t.section === course.normalSection);
        const p = s.practice.find((t) => t.section === course.practiceSection);
        for (const sec of [n, p]) {
          if (sec) chips.push({
            code: course.code, kind: sec.kind, section: sec.section,
            teacher: sec.teacher, slots: sec.schedule,
          });
        }
      } catch {
        // у курса может не быть секций (практика, проекты) — просто без чипов
      }
    }
    cache.basketSchedule = chips;
  }
  return {
    authenticated: true,
    term: me.term, isApproved: me.isApproved,
    track: me.track, progTrack: me.progTrack,
    approved: me.approved,
    schedule: cache.basketSchedule,
  };
}

app.get('/api/me', wrap(async (req, res) => {
  if (DEMO) return res.json(demo.me());
  const client = requireAuth(req);
  res.json(await getMe(client, cacheFor(client)));
}));

app.get('/api/curriculum', wrap(async (req, res) => {
  if (DEMO) return res.json(demo.curriculum());
  const client = requireAuth(req);
  res.json(await getCurriculum(client, cacheFor(client)));
}));

app.get('/api/sections', wrap(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code) throw new HttpError(400, 'укажите ?code=');
  if (DEMO) return res.json(demo.sections(code));
  const client = requireAuth(req);
  const cache = cacheFor(client);
  const curriculum = await getCurriculum(client, cache);
  const found = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.code.toUpperCase() === code.toUpperCase());
  const params = found?.sectionsParams ?? cache.sectionsDefaults;
  if (!params) throw new HttpError(502, `не знаем параметры программы для ${code}`);
  // mufSqId нужен для курсов, выбранных из элективной группы (переменная elave у портала)
  const mufSqId = req.query.mufSqId ? String(req.query.mufSqId) : undefined;
  res.json(await client.getSections({ ...params, dk: code, mufSqId }));
}));

app.get('/api/search', wrap(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code) throw new HttpError(400, 'укажите ?code=');
  if (DEMO) return res.json(demo.sections(code));
  const client = requireAuth(req);
  const cache = cacheFor(client);
  await getCurriculum(client, cache); // заодно валидирует сессию и кладёт defaults
  res.json(await client.searchCourse(code, cache.me?.progTrack ?? 'TRACK0'));
}));

// ------------------------------------------------------------------ профиль
app.get('/api/profile', wrap(async (req, res) => {
  const client = requireAuth(req);
  if (!client.localUsername) throw new HttpError(401, 'Не найден локальный пользователь');
  const { rows } = await pool.query('SELECT username, display_name, avatar_url, role FROM users WHERE username = $1', [client.localUsername]);
  if (rows.length === 0) throw new HttpError(404, 'Профиль не найден');
  res.json(rows[0]);
}));

app.put('/api/profile', wrap(async (req, res) => {
  const client = requireAuth(req);
  if (!client.localUsername) throw new HttpError(401, 'Не найден локальный пользователь');
  const { display_name, avatar_url } = req.body ?? {};
  
  const { rows } = await pool.query(
    'UPDATE users SET display_name = $1, avatar_url = $2 WHERE username = $3 RETURNING username, display_name, avatar_url, role',
    [display_name, avatar_url, client.localUsername]
  );
  res.json(rows[0]);
}));

function requireAdmin(req) {
  const client = requireAuth(req);
  if (client.localRole !== 'Administrator') {
    throw new HttpError(403, 'Доступ запрещен. Требуются права администратора.');
  }
  return client;
}

// ------------------------------------------------------------------ админка
app.get('/api/admin/users', wrap(async (req, res) => {
  requireAdmin(req);
  const { rows } = await pool.query('SELECT id, username, display_name, role, is_blocked, created_at FROM users ORDER BY created_at DESC');
  res.json(rows);
}));

app.put('/api/admin/users/:username/role', wrap(async (req, res) => {
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

app.put('/api/admin/users/:username/block', wrap(async (req, res) => {
  requireAdmin(req);
  const { is_blocked } = req.body ?? {};
  const { rows } = await pool.query(
    'UPDATE users SET is_blocked = $1 WHERE username = $2 RETURNING id, username, is_blocked',
    [!!is_blocked, req.params.username]
  );
  if (rows.length === 0) throw new HttpError(404, 'Пользователь не найден');
  res.json(rows[0]);
}));

// Список курсов элективной группы (заглушка XXX ...): сначала пробуем эндпоинт
// портала ShowElectiveCoursesByElCode, при неудаче отдаём коды из group_title.
app.post('/api/electives', wrap(async (req, res) => {
  const { dk, mufSqId, periodNo, groupName, candidates = [], codeType, lgCode, type } = req.body ?? {};
  if (!dk) throw new HttpError(400, 'укажите dk (код заглушки электива)');
  if (DEMO) {
    return res.json({ fromPortal: false, courses: candidates.map((code) => ({ code, name: '' })) });
  }
  const client = requireAuth(req);
  const cache = cacheFor(client);
  await getCurriculum(client, cache);
  const def = cache.sectionsDefaults ?? {};
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

// ------------------------------------------------------------------ статика
// На Vercel статику отдаёт платформа (web/dist); этот блок нужен для локального запуска.
const webDist = path.resolve('web/dist');
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webDist, 'index.html'));
});

// На Vercel слушатель не нужен: платформа сама вызывает app.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ZeMe server: http://localhost:${PORT}  (${DEMO ? 'DEMO на дампах' : 'live: my.sdu.edu.kz'})`);
  });
}

export { app };
