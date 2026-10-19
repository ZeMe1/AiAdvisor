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
import { parseTranscript, normalizeGrade, computeSummary, computeAcademicProgress } from './transcript-parser.mjs';

// Initialize DB on startup (CREATE TABLE IF NOT EXISTS — safe to run repeatedly)
initDb().catch(console.error);


const PORT = Number(process.env.PORT || 3001);
const DEMO = process.env.DEMO === '1';

const app = express();
app.use(express.json({ limit: '15mb' }));

// ------------------------------------------------- сессия в подписанной куке
const SECRET = process.env.SESSION_SECRET || 'zeme_default_secret_for_vercel_and_dev_0123456789';
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
  const oldJson = res.json;
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 400 && req.client && req.client.status !== 'anonymous') {
      setSessionCookie(res, req.client);
    }
    return oldJson.call(res, body);
  };
  
  try {
    await fn(req, res);
  } catch (e) {
    const expired = e.sessionExpired === true;
    if (expired) {
      req.client = null;
      clearSessionCookie(res);
    }
    const status = expired ? 401 : (e instanceof HttpError ? e.status : 502);
    if (status >= 500) console.error(`[api] ${req.method} ${req.path}:`, e.message);
    res.status(status);
    oldJson.call(res, { error: e.message || 'internal error', ...(expired ? { sessionExpired: true } : {}) });
  }
};

function sessionExpiredError() {
  const e = new HttpError(401, 'Portal session expired — please log in again');
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

// Light rate-limit on auth endpoints: 12 requests / min / IP.
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
  if (!username || !password) throw new HttpError(400, 'Username and password are required');
  const client = req.client && req.client.status === 'pending_2fa' ? req.client : new SduClient();
  const r = await client.login(String(username), String(password));
  if (!r.ok) throw new HttpError(401, 'Invalid username or password');

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
      throw new HttpError(403, 'Your account has been suspended/blocked');
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
  if (!client || client.status !== 'pending_2fa') throw new HttpError(400, '2FA is not pending');
  const { code } = req.body ?? {};
  if (!/^\d{6}$/.test(String(code ?? ''))) throw new HttpError(400, 'Code must be 6 digits');
  const r = await client.submit2fa(String(code));
  if (!r.ok) throw new HttpError(401, 'Invalid or expired 2FA code. Please log in again to receive a new code');
  setSessionCookie(res, client);
  res.json({ status: 'ok' });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  req.client = null;
  clearSessionCookie(res);
  res.json({ status: 'ok' });
}));

// ------------------------------------------------------------------ data
/** Section parameters (pc/py/track) from curriculum, cached in session. */
async function getCurriculum(client, cache) {
  if (cache.curriculum) return cache.curriculum;
  const me = await client.getCourseReg();
  if (me.authenticated === false) throw sessionExpiredError();
  const trackId = me.track?.id;
  if (!trackId) throw new HttpError(502, 'Could not find track ID on course registration page');
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

function resolveSemesterNumber(semesterStr, programTitle = '') {
  if (!semesterStr) return 1;
  const str = String(semesterStr).trim().toLowerCase();

  // Extract start year from program title, e.g. "2024-Information Systems (EN)" -> 2024
  let startYear = 2024;
  const titleYearMatch = String(programTitle).match(/\b(20\d\d)\b/);
  if (titleYearMatch) {
    startYear = parseInt(titleYearMatch[1], 10);
  }

  // If format is like "Fall 2026", "2026 Fall", "Spring 2027", etc.
  const yearMatch = str.match(/\b(20\d\d)\b/);
  const isFall = str.includes('fall') || str.includes('осень') || str.includes('autumn');
  const isSpring = str.includes('spring') || str.includes('весна');

  if (yearMatch && (isFall || isSpring)) {
    const courseYear = parseInt(yearMatch[1], 10);
    const yearDiff = courseYear - startYear;
    if (isFall) {
      // 2024 Fall -> 1, 2025 Fall -> 3, 2026 Fall -> 5, 2027 Fall -> 7
      const calculated = yearDiff * 2 + 1;
      if (calculated >= 1 && calculated <= 12) return calculated;
    } else if (isSpring) {
      // 2025 Spring -> 2, 2026 Spring -> 4, 2027 Spring -> 6, 2028 Spring -> 8
      const calculated = yearDiff * 2;
      if (calculated >= 1 && calculated <= 12) return calculated;
    }
  }

  // If contains explicit semester number, e.g. "Семестр 5", "Semester 5", "5"
  const semMatch = str.match(/(?:семестр|semester|sem)?\s*([1-8])\b/i);
  if (semMatch) {
    return parseInt(semMatch[1], 10);
  }

  const anyDigit = str.match(/[1-8]/);
  if (anyDigit) return parseInt(anyDigit[0], 10);

  return 1;
}

async function applyCatalogToCurriculum(rawCurriculum) {
  if (!rawCurriculum || !Array.isArray(rawCurriculum.semesters)) return rawCurriculum;
  const curriculum = JSON.parse(JSON.stringify(rawCurriculum));

  try {
    const { rows: dbCourses } = await pool.query('SELECT * FROM courses');
    if (!dbCourses || dbCourses.length === 0) return curriculum;

    const archivedCodes = new Set(
      dbCourses.filter(c => c.is_archived).map(c => (c.code || '').toUpperCase())
    );
    const activeDbCourses = dbCourses.filter(c => !c.is_archived);
    const activeByCode = new Map(
      activeDbCourses.map(c => [(c.code || '').toUpperCase(), c])
    );

    const matchedDbCodes = new Set();

    // 1. Update or remove existing courses in curriculum
    for (const sem of curriculum.semesters) {
      sem.courses = (sem.courses || []).filter(course => {
        const codeUpper = (course.code || '').toUpperCase();
        if (archivedCodes.has(codeUpper)) {
          return false; // Archived course disappears from the catalog
        }
        return true;
      }).map(course => {
        const codeUpper = (course.code || '').toUpperCase();
        const dbMatch = activeByCode.get(codeUpper);
        if (dbMatch) {
          matchedDbCodes.add(codeUpper);
          return {
            ...course,
            name: dbMatch.name || course.name,
            credits: dbMatch.credits || course.credits,
            ects: dbMatch.credits || course.ects,
            description: dbMatch.description || course.description,
            language: dbMatch.language || course.language,
            teacher: dbMatch.teacher || course.teacher || '',
            quota: dbMatch.quota || course.quota || 30
          };
        }
        return course;
      });
    }

    // 2. Add newly created courses from DB that were not in base curriculum
    for (const dbCourse of activeDbCourses) {
      const codeUpper = (dbCourse.code || '').toUpperCase();
      if (!matchedDbCodes.has(codeUpper)) {
        const semNo = resolveSemesterNumber(dbCourse.semester, curriculum.program?.title);

        let targetSem = curriculum.semesters.find(s => s.no === semNo);
        if (!targetSem) {
          targetSem = { no: semNo, courses: [] };
          curriculum.semesters.push(targetSem);
          curriculum.semesters.sort((a, b) => a.no - b.no);
        }

        targetSem.courses.push({
          code: dbCourse.code,
          name: dbCourse.name,
          hours: { teor: 2, practice: '0+2' },
          credits: dbCourse.credits || 5,
          ects: dbCourse.credits || 5,
          grade: '',
          status: 'not_taken',
          isElective: false,
          isCustom: true,
          description: dbCourse.description || '',
          language: dbCourse.language || 'English',
          semester: dbCourse.semester || '',
          teacher: dbCourse.teacher || '',
          quota: dbCourse.quota || 30,
          sectionsParams: null
        });
      }
    }
  } catch (err) {
    console.error('[curriculum] Error merging catalog courses:', err.message);
  }

  return curriculum;
}

app.get('/api/curriculum', wrap(async (req, res) => {
  if (DEMO) {
    const curr = demo.curriculum();
    return res.json(await applyCatalogToCurriculum(curr));
  }
  const client = requireAuth(req);
  const curr = await getCurriculum(client, cacheFor(client));
  res.json(await applyCatalogToCurriculum(curr));
}));

function generateCustomSections(course) {
  const code = String(course.code || '').trim().toUpperCase();
  const name = String(course.name || code).trim();
  const theoryTeacher = String(course.theory_teacher || course.teacher || 'Aliya Zhunis').trim();
  const practiceTeacher = String(course.practice_teacher || course.theory_teacher || course.teacher || 'Yerlan Berikov').trim();
  const quota = Number(course.quota) || 25;
  const ects = Number(course.credits) || 5;
  const shortCode = code.replace(/\s+/g, '');
  const depCode = code.split(' ')[0] || 'CSS';

  const theoryPresets = [
    { section: '01', day: 2, times: ['15:30', '16:30'], enrolled: Math.min(quota, Math.max(1, quota - 5)), available: true },
    { section: '02', day: 2, times: ['18:30', '19:30'], enrolled: Math.min(quota, Math.max(1, quota - 2)), available: true },
    { section: '03', day: 3, times: ['11:30', '12:30'], enrolled: quota, available: false },
    { section: '04', day: 4, times: ['14:30', '15:30'], enrolled: Math.min(quota, Math.max(1, quota - 10)), available: true },
    { section: '05', day: 5, times: ['10:30', '11:30'], enrolled: Math.min(quota, Math.max(1, quota - 7)), available: true },
  ];

  const practicePresets = [
    { section: '01', day: 1, times: ['14:30', '15:30'], enrolled: Math.min(quota, Math.max(1, quota - 4)), available: true },
    { section: '02', day: 4, times: ['11:30', '12:30'], enrolled: Math.min(quota, Math.max(1, quota - 8)), available: true },
  ];

  const practice = practicePresets.map((p) => ({
    id: `${shortCode}_P_${p.section}`,
    courseCode: code,
    section: p.section,
    kind: 'P',
    teacher: practiceTeacher,
    quota: quota,
    enrolled: p.enrolled,
    reserved: 0,
    message: 'IS 4',
    isAvailable: p.available,
    schedule: p.times.map(t => ({ day: p.day, time: t }))
  }));

  const theory = theoryPresets.map((t) => ({
    id: `${shortCode}_N_${t.section}`,
    courseCode: code,
    section: t.section,
    kind: 'N',
    teacher: theoryTeacher,
    quota: quota,
    enrolled: t.enrolled,
    reserved: 0,
    message: 'IS 4',
    isAvailable: t.available,
    practiceIds: practice.map(p => p.id),
    schedule: t.times.map(time => ({ day: t.day, time }))
  }));

  return {
    course: {
      code,
      name,
      hours: '2+0+2',
      credits: Math.max(1, Math.round(ects * 0.6)),
      ects: ects
    },
    depCode,
    progCode: 'IS',
    theory,
    practice,
    lab: []
  };
}

app.get('/api/sections', wrap(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code) throw new HttpError(400, 'specify ?code=');

  // Check if this course is a custom course from DB
  const { rows: dbCourses } = await pool.query('SELECT * FROM courses');
  const dbMatch = (dbCourses || []).find(c => (c.code || '').trim().toUpperCase() === code.toUpperCase());
  if (dbMatch) {
    return res.json(generateCustomSections(dbMatch));
  }

  if (DEMO) return res.json(demo.sections(code));
  const client = requireAuth(req);
  const cache = cacheFor(client);
  const curriculum = await getCurriculum(client, cache);
  const found = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.code.toUpperCase() === code.toUpperCase());
  const params = found?.sectionsParams ?? cache.sectionsDefaults;
  if (!params) {
    return res.json(generateCustomSections({ code, name: code, credits: 5 }));
  }
  const mufSqId = req.query.mufSqId ? String(req.query.mufSqId) : undefined;
  try {
    res.json(await client.getSections({ ...params, dk: code, mufSqId }));
  } catch (err) {
    res.json(generateCustomSections({ code, name: code, credits: 5 }));
  }
}));

app.get('/api/search', wrap(async (req, res) => {
  const code = String(req.query.code ?? '').trim();
  if (!code) throw new HttpError(400, 'specify ?code=');
  if (DEMO) return res.json(demo.sections(code));
  const client = requireAuth(req);
  const cache = cacheFor(client);
  await getCurriculum(client, cache); // validates session and sets defaults
  res.json(await client.searchCourse(code, cache.me?.progTrack ?? 'TRACK0'));
}));

// ------------------------------------------------------------------ profile
app.get('/api/profile', wrap(async (req, res) => {
  const client = requireAuth(req);
  if (!client.localUsername) throw new HttpError(401, 'Local user not found');
  const { rows } = await pool.query('SELECT username, display_name, avatar_url, role FROM users WHERE username = $1', [client.localUsername]);
  if (rows.length === 0) throw new HttpError(404, 'Profile not found');
  res.json(rows[0]);
}));

app.put('/api/profile', wrap(async (req, res) => {
  const client = requireAuth(req);
  if (!client.localUsername) throw new HttpError(401, 'Local user not found');
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
    throw new HttpError(403, 'Access denied. Administrator privileges required.');
  }
  return client;
}

// ------------------------------------------------------------------ admin users
app.get('/api/admin/users', wrap(async (req, res) => {
  requireAdmin(req);
  const { rows } = await pool.query('SELECT id, username, display_name, role, is_blocked, created_at FROM users ORDER BY created_at DESC');
  res.json(rows);
}));

app.put('/api/admin/users/:username/role', wrap(async (req, res) => {
  requireAdmin(req);
  const { role } = req.body ?? {};
  if (!['Student', 'Advisor', 'Administrator'].includes(role)) {
    throw new HttpError(400, 'Invalid role');
  }
  const { rows } = await pool.query(
    'UPDATE users SET role = $1 WHERE username = $2 RETURNING id, username, role',
    [role, req.params.username]
  );
  if (rows.length === 0) throw new HttpError(404, 'User not found');
  res.json(rows[0]);
}));

app.put('/api/admin/users/:username/block', wrap(async (req, res) => {
  requireAdmin(req);
  const { is_blocked } = req.body ?? {};
  const { rows } = await pool.query(
    'UPDATE users SET is_blocked = $1 WHERE username = $2 RETURNING id, username, is_blocked',
    [!!is_blocked, req.params.username]
  );
  if (rows.length === 0) throw new HttpError(404, 'User not found');
  res.json(rows[0]);
}));

// --------------------------------------------------------- courses (catalog) — admin CRUD
// GET all courses (admin sees all including archived)
app.get('/api/admin/courses', wrap(async (req, res) => {
  requireAdmin(req);
  const { rows } = await pool.query(
    'SELECT * FROM courses ORDER BY is_archived ASC, code ASC'
  );
  res.json(rows);
}));

// POST create a course
app.post('/api/admin/courses', wrap(async (req, res) => {
  requireAdmin(req);
  const { code, name, credits, description, language, semester, theory_teacher, practice_teacher, teacher, quota } = req.body ?? {};
  if (!code || !name) throw new HttpError(400, 'Course code and title are required');
  if (credits != null && (isNaN(Number(credits)) || Number(credits) < 1)) {
    throw new HttpError(400, 'Credits must be a positive number');
  }
  const tTeacher = String(theory_teacher ?? teacher ?? '').trim();
  const pTeacher = String(practice_teacher ?? theory_teacher ?? teacher ?? '').trim();

  try {
    const { rows } = await pool.query(
      `INSERT INTO courses (code, name, credits, description, language, semester, teacher, theory_teacher, practice_teacher, quota)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        String(code).trim().toUpperCase(),
        String(name).trim(),
        Number(credits) || 5,
        String(description ?? '').trim(),
        String(language ?? 'English').trim(),
        String(semester ?? '').trim(),
        tTeacher,
        tTeacher,
        pTeacher,
        Number(quota) || 30,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      throw new HttpError(409, 'Course code must be unique');
    }
    throw e;
  }
}));

// PUT update a course
app.put('/api/admin/courses/:id', wrap(async (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  if (!id) throw new HttpError(400, 'Invalid course id');
  const { code, name, credits, description, language, semester, theory_teacher, practice_teacher, teacher, quota } = req.body ?? {};
  if (!code || !name) throw new HttpError(400, 'Course code and title are required');
  if (credits != null && (isNaN(Number(credits)) || Number(credits) < 1)) {
    throw new HttpError(400, 'Credits must be a positive number');
  }
  const tTeacher = String(theory_teacher ?? teacher ?? '').trim();
  const pTeacher = String(practice_teacher ?? theory_teacher ?? teacher ?? '').trim();

  try {
    const { rows } = await pool.query(
      `UPDATE courses SET code = $1, name = $2, credits = $3, description = $4,
       language = $5, semester = $6, teacher = $7, theory_teacher = $8, practice_teacher = $9,
       quota = $10, updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 RETURNING *`,
      [
        String(code).trim().toUpperCase(),
        String(name).trim(),
        Number(credits) || 5,
        String(description ?? '').trim(),
        String(language ?? 'English').trim(),
        String(semester ?? '').trim(),
        tTeacher,
        tTeacher,
        pTeacher,
        Number(quota) || 30,
        id,
      ]
    );
    if (rows.length === 0) throw new HttpError(404, 'Course not found');
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      throw new HttpError(409, 'Course code must be unique');
    }
    throw e;
  }
}));

// DELETE course (permanent removal)
app.delete('/api/admin/courses/:id', wrap(async (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  if (!id) throw new HttpError(400, 'Invalid course id');
  const { rows } = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING *', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Course not found');
  res.json({ status: 'ok', deleted: rows[0] });
}));

// PUT archive / unarchive a course
app.put('/api/admin/courses/:id/archive', wrap(async (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  if (!id) throw new HttpError(400, 'Invalid course id');
  const { is_archived } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE courses SET is_archived = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 RETURNING *`,
    [!!is_archived, id]
  );
  if (rows.length === 0) throw new HttpError(404, 'Course not found');
  res.json(rows[0]);
}));

// Public catalog — students see only non-archived courses
app.get('/api/catalog', wrap(async (req, res) => {
  requireAuth(req);
  const { rows } = await pool.query(
    'SELECT id, code, name, credits, description, language, semester FROM courses WHERE is_archived = false ORDER BY code ASC'
  );
  res.json(rows);
}));

// --------------------------------------------------------- prerequisites (Story 7: Manage Prerequisites)
function detectCycle(allLinks, newCourse, newPrereq) {
  const c = String(newCourse).trim().toUpperCase();
  const p = String(newPrereq).trim().toUpperCase();
  if (c === p) {
    return [c, p];
  }

  const graph = new Map();
  for (const link of allLinks) {
    const from = (link.course_code || '').toUpperCase();
    const to = (link.prereq_code || '').toUpperCase();
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  }

  // Check if adding c -> p creates a cycle (i.e. p already reaches c)
  const queue = [[p]];
  const visited = new Set([p]);

  while (queue.length > 0) {
    const path = queue.shift();
    const curr = path[path.length - 1];

    if (curr === c) {
      return [c, ...path];
    }

    const nexts = graph.get(curr) || [];
    for (const n of nexts) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push([...path, n]);
      }
    }
  }

  return null;
}

app.get('/api/admin/prerequisites', wrap(async (req, res) => {
  requireAdmin(req);
  const { rows } = await pool.query('SELECT * FROM prerequisites');
  res.json(rows);
}));

app.post('/api/admin/prerequisites', wrap(async (req, res) => {
  requireAdmin(req);
  const { course_code, prereq_code, min_grade = 'C', type = 'prerequisite' } = req.body ?? {};
  if (!course_code || !prereq_code) {
    throw new HttpError(400, 'Course code and prerequisite code are required');
  }

  const cCode = String(course_code).trim().toUpperCase();
  const pCode = String(prereq_code).trim().toUpperCase();

  if (cCode === pCode) {
    throw new HttpError(400, 'Course cannot be a prerequisite for itself');
  }

  // Fetch all existing links
  const { rows: allLinks } = await pool.query('SELECT * FROM prerequisites');
  const cycle = detectCycle(allLinks, cCode, pCode);
  if (cycle) {
    throw new HttpError(400, `Circular dependency detected: ${cycle.join(' -> ')}`);
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO prerequisites (course_code, prereq_code, min_grade, type) VALUES ($1, $2, $3, $4) RETURNING *',
      [cCode, pCode, String(min_grade).trim(), String(type).trim()]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw new HttpError(409, 'This relationship already exists');
    }
    throw err;
  }
}));

app.delete('/api/admin/prerequisites/:id', wrap(async (req, res) => {
  requireAdmin(req);
  const id = Number(req.params.id);
  if (!id) throw new HttpError(400, 'Invalid id');
  const { rows } = await pool.query('DELETE FROM prerequisites WHERE id = $1 RETURNING *', [id]);
  if (rows.length === 0) throw new HttpError(404, 'Relationship not found');
  res.json({ status: 'ok', deleted: rows[0] });
}));

// Elective course list
app.post('/api/electives', wrap(async (req, res) => {
  const { dk, mufSqId, periodNo, groupName, candidates = [], codeType, lgCode, type } = req.body ?? {};
  if (!dk) throw new HttpError(400, 'specify dk (elective code)');
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

// ------------------------------------------------- Story 9: Transcript & Grades Management
// Get student's completed courses / transcript
app.get('/api/student/transcript', wrap(async (req, res) => {
  const client = requireAuth(req);
  const username = client?.localUsername || (DEMO ? '240103165' : null);
  const { rows } = await pool.query(
    'SELECT * FROM student_transcripts WHERE username = $1',
    [username]
  );
  const summary = computeSummary(rows);
  res.json({
    courses: rows,
    ...summary
  });
}));

// Story 10: See GPA and Academic Progress (Dashboard, GPA trend, Degree progress)
app.get('/api/student/progress', wrap(async (req, res) => {
  const client = requireAuth(req);
  const username = client?.localUsername || (DEMO ? '240103165' : null);
  if (!username) throw new HttpError(401, 'Unauthorized');

  const { rows } = await pool.query(
    'SELECT * FROM student_transcripts WHERE username = $1 ORDER BY id ASC',
    [username]
  );

  const progress = computeAcademicProgress(rows, 240);
  res.json({
    username,
    ...progress
  });
}));

// Parse uploaded transcript file (PDF or XLSX) for preview & matching
app.post('/api/student/transcript/parse', wrap(async (req, res) => {
  const client = requireAuth(req);
  const { fileData, fileName } = req.body ?? {};
  if (!fileData) throw new HttpError(400, 'Transcript file is required');

  const base64Data = fileData.replace(/^data:.*?;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0) throw new HttpError(400, 'File is empty');

  // Fetch catalog courses to assist matching
  const { rows: catalogCourses } = await pool.query('SELECT code, name, credits FROM courses WHERE is_archived = false');

  const authUser = {
    username: client?.localUsername || (DEMO ? '240103165' : null),
    role: client?.localRole || 'Student'
  };

  const parsed = await parseTranscript(buffer, fileName || 'transcript.pdf', catalogCourses, authUser);
  res.json(parsed);
}));

// Confirm recognized transcript courses and save to profile
app.post('/api/student/transcript/confirm', wrap(async (req, res) => {
  const client = requireAuth(req);
  const username = client?.localUsername || (DEMO ? '240103165' : null);
  const { courses } = req.body ?? {};
  if (!Array.isArray(courses) || courses.length === 0) {
    throw new HttpError(400, 'Course list cannot be empty');
  }

  const saved = [];
  for (const c of courses) {
    const code = String(c.course_code || '').trim().toUpperCase();
    if (!code) continue;
    const name = String(c.course_name || code).trim();
    const credits = Number(c.credits) || 5;
    const gradeInfo = normalizeGrade(c.grade || 'P');
    const semester = String(c.semester || 'Completed').trim();

    const { rows } = await pool.query(
      `INSERT INTO student_transcripts (username, course_code, course_name, credits, grade, gpa_points, semester)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [username, code, name, credits, gradeInfo.grade, gradeInfo.gpa, semester]
    );
    if (rows[0]) saved.push(rows[0]);
  }

  const summary = computeSummary(saved);
  res.json({
    status: 'ok',
    savedCount: saved.length,
    courses: saved,
    ...summary
  });
}));

// Manually add or update a completed course
app.post('/api/student/transcript/manual', wrap(async (req, res) => {
  const client = requireAuth(req);
  const username = client?.localUsername || (DEMO ? '240103165' : null);
  const { course_code, course_name, credits, grade, semester } = req.body ?? {};
  if (!course_code) throw new HttpError(400, 'Course code is required');

  const code = String(course_code).trim().toUpperCase();
  const name = String(course_name || code).trim();
  const cCredits = Number(credits) || 5;
  const gradeInfo = normalizeGrade(grade || 'A');
  const sem = String(semester || 'Completed').trim();

  const { rows } = await pool.query(
    `INSERT INTO student_transcripts (username, course_code, course_name, credits, grade, gpa_points, semester)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [username, code, name, cCredits, gradeInfo.grade, gradeInfo.gpa, sem]
  );

  res.json(rows[0]);
}));

// Delete a single course from transcript
app.delete('/api/student/transcript/:id', wrap(async (req, res) => {
  const client = requireAuth(req);
  const username = client?.localUsername || (DEMO ? '240103165' : null);
  const id = Number(req.params.id);
  if (!id) throw new HttpError(400, 'Invalid id');

  const { rows } = await pool.query(
    'DELETE FROM student_transcripts WHERE id = $1 AND username = $2 RETURNING *',
    [id, username]
  );
  if (rows.length === 0) throw new HttpError(404, 'Course not found');
  res.json({ status: 'ok', deleted: rows[0] });
}));

// Clear student's entire transcript (privacy & reset)
app.delete('/api/student/transcript', wrap(async (req, res) => {
  const client = requireAuth(req);
  const username = client?.localUsername || (DEMO ? '240103165' : null);
  await pool.query('DELETE FROM student_transcripts WHERE username = $1', [username]);
  res.json({ status: 'ok', message: 'Transcript cleared successfully' });
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
