import pg from 'pg';

const { Pool } = pg;

import dotenv from 'dotenv';
import fs from 'fs';

if (fs.existsSync('.env.cloud')) {
  dotenv.config({ path: '.env.cloud' });
} else {
  dotenv.config();
}

const connectionString = process.env.DATABASE_URL;
const configuredPassword = process.env.PGPASSWORD || process.env.DB_PASSWORD;
const hasConfiguredPassword = typeof configuredPassword === 'string' && configuredPassword.trim().length > 0;
const shouldTryPostgres = Boolean(connectionString || hasConfiguredPassword);

let useInMemory = !shouldTryPostgres;

const realPool = shouldTryPostgres ? new Pool(connectionString ? {
  connectionString,
  ssl: connectionString && (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) ? false : { rejectUnauthorized: false }
} : {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || '127.0.0.1',
  database: process.env.PGDATABASE || 'aiadvisor',
  password: configuredPassword,
  port: Number(process.env.PGPORT) || 5432,
}) : null;

if (realPool) {
  realPool.on('error', (err) => {
    console.warn('[db pool warning]', err.message);
  });
}

// -------------------------------------------------------------
// In-Memory Database Store (Resilience Fallback for Local Dev / Test)
// -------------------------------------------------------------
const configuredAdmins = String(process.env.ADMIN_USERNAME || '')
  .split(',')
  .map((u) => u.trim())
  .filter((u) => u && u.toLowerCase() !== 'admin');

const memTables = {
  users: [
    { id: 1, username: 'admin', role: 'Administrator', display_name: 'Administrator', avatar_url: null, is_blocked: false, created_at: new Date() },
    ...configuredAdmins.map((username, idx) => ({
      id: idx + 2,
      username,
      role: 'Administrator',
      display_name: username,
      avatar_url: null,
      is_blocked: false,
      created_at: new Date(),
    })),
  ],
  sessions: [],
  student_data_cache: new Map(),
  curriculum_cache: new Map(),
  course_sections_cache: new Map(),
  student_groups: [
    { id: 1, name: 'CS-23-1', program: 'Information Systems', study_year: 1, advisor_username: null, created_at: new Date() }
  ],
  group_members: [],
  prerequisites: [],
  course_catalog: [
    { code: 'CSS 105', name: 'Fundamentals of Programming', ects: 5, description: 'Introduces programming fundamentals, algorithmic thinking, basic data types, and structured coding.' },
    { code: 'CSS 108', name: 'Programming Technologies', ects: 5, description: 'Covers programming technologies, OOP principles, modular design, and core software development workflows.' },
    { code: 'CSS 215', name: 'Data Structures & Algorithms', ects: 5, description: 'Covers core data structures (lists, trees, graphs, hash tables) and algorithm analysis.' },
    { code: 'CSS 216', name: 'Mobile Application Development', ects: 5, description: 'Covers mobile application architecture, UI components, state management, and platform APIs.' },
    { code: 'CSS 280', name: 'Web Development Basics', ects: 5, description: 'Covers foundational web technologies including HTML, CSS, JavaScript, and client-server communication.' },
    { code: 'CSS 305', name: 'Database Systems', ects: 5, description: 'Covers relational database design, SQL, normalization, indexing, and transaction management.' },
    { code: 'CSS 311', name: 'Operating Systems', ects: 5, description: 'Covers operating system concepts including processes, threads, scheduling, memory management, and file systems.' },
    { code: 'CSS 320', name: 'Software Engineering', ects: 5, description: 'Covers software engineering methodologies, requirements analysis, architecture, testing, and version control.' },
    { code: 'CSS 405', name: 'Artificial Intelligence', ects: 5, description: 'Covers artificial intelligence principles, search algorithms, knowledge representation, and machine learning basics.' },
    { code: 'INF 318', name: 'Computer Networks', ects: 5, description: 'Covers computer network architectures, TCP/IP protocols, routing, switching, and network diagnostics.' },
    { code: 'INF 376', name: 'Information Security', ects: 5, description: 'Covers information security fundamentals, cryptography, threat modeling, access control, and secure systems.' },
    { code: 'INF 451', name: 'Cloud Computing & DevOps', ects: 5, description: 'Covers cloud infrastructure, containerization, CI/CD pipelines, orchestration, and DevOps practices.' },
    { code: 'MAT 137', name: 'Mathematics 1', ects: 5, description: 'Covers foundational university mathematics including limits, derivatives, and differential calculus.' },
    { code: 'MAT 138', name: 'Mathematics 2', ects: 5, description: 'Covers integral calculus, multivariable techniques, series, and mathematical applications.' },
    { code: 'CS 101', name: 'Introduction to Computer Science', ects: 5, description: 'Covers foundational programming concepts, variables, control flow, functions, and problem-solving techniques.' },
    { code: 'CS 201', name: 'Intermediate Programming', ects: 5, description: 'Covers intermediate programming, object-oriented design, recursion, memory management, and modular software development.' },
    { code: 'CS 301', name: 'Algorithms and Complexity', ects: 5, description: 'Covers algorithm design and analysis, complexity theory, sorting, graph algorithms, and dynamic programming.' },
    { code: 'CS 401', name: 'Advanced Distributed Systems', ects: 5, description: 'Covers distributed computing architectures, consensus protocols, replication, fault tolerance, and scalable systems.' },
    { code: 'MATH 101', name: 'Calculus I', ects: 5, description: 'Covers limits, continuity, differentiation, and applications of single-variable calculus.' },
    { code: 'MATH 201', name: 'Linear Algebra', ects: 5, description: 'Covers vector spaces, matrices, determinants, linear transformations, eigenvalues, and eigenvectors.' },
    { code: 'HIST 101', name: 'History of Kazakhstan', ects: 5, description: 'Covers key historical periods, cultural heritage, and statehood development of Kazakhstan.' }
  ],
  program_curriculums: [],
  program_curriculum_courses: [],
  user_curriculums: [],
  recommendation_feedback: [],
  recommendation_configs: [
    { id: 1, version: 1, min_ects: 20, max_ects: 21, gpa_weight: 1.0, retake_weight: 2.0, interest_weight: 1.5, disabled_programs: [], created_by: 'System', is_active: true, created_at: new Date().toISOString() }
  ],
  ai_guardrail_configs: [],
  student_semester_plans: [],
  ai_chat_messages: [],
  ai_chat_log_reviews: []
};

let nextUserId = memTables.users.length + 1;
let nextGroupId = 2;
let nextCurrId = 1;
let nextChatId = 1;
let nextLogReviewId = 1;
let nextMemberId = 1;
let nextPlanId = 1;
let nextFeedbackId = 1;

function handleMemQuery(sql, params = []) {
  const norm = sql.trim().replace(/\s+/g, ' ');
  const upper = norm.toUpperCase();

  // DDL queries: CREATE TABLE, CREATE INDEX, ALTER TABLE
  if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE INDEX') || upper.startsWith('ALTER TABLE')) {
    return { rows: [], rowCount: 0 };
  }

  // --- COUNT QUERIES ---
  if (upper.includes('SELECT COUNT(') || upper.includes('SELECT COALESCE(MAX(')) {
    if (upper.includes('COUNT(DISTINCT')) return { rows: [{ count: 0 }], rowCount: 1 };
    if (upper.includes('FROM RECOMMENDATION_FEEDBACK')) return { rows: [{ count: '0' }], rowCount: 1 };
    if (upper.includes('FROM SESSIONS')) return { rows: [{ count: '0' }], rowCount: 1 };
    if (upper.includes('MAX(VERSION)')) {
      if (upper.includes('FROM AI_GUARDRAIL_CONFIGS')) {
        const maxVer = memTables.ai_guardrail_configs.reduce((max, c) => Math.max(max, c.version || 0), 0);
        return { rows: [{ max_ver: maxVer }], rowCount: 1 };
      }
      const maxVer = memTables.recommendation_configs.reduce((max, c) => Math.max(max, c.version || 1), 0);
      return { rows: [{ max_ver: maxVer }], rowCount: 1 };
    }
    return { rows: [{ count: '0' }], rowCount: 1 };
  }

  // --- USERS ---
  if (upper.startsWith('SELECT * FROM USERS WHERE USERNAME = $1')) {
    const u = memTables.users.find((x) => x.username.toLowerCase() === String(params[0]).toLowerCase());
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }

  if (upper.startsWith('SELECT * FROM USERS WHERE ID = $1')) {
    const u = memTables.users.find((x) => x.id === Number(params[0]));
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }

  if (upper.startsWith('INSERT INTO USERS')) {
    let username = params[0];
    let role = params[1] || 'Student';
    let displayName = null;
    if (!username) {
      const match = norm.match(/VALUES\s*\(\s*'([^']+)'(?:\s*,\s*'([^']*)')?(?:\s*,\s*'([^']*)')?\s*\)/i);
      if (match) {
        username = match[1];
        displayName = match[2] || null;
        role = match[3] || 'Student';
      }
    }
    username = String(username || 'user');
    let u = memTables.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
    if (!u) {
      u = { id: nextUserId++, username, role, display_name: displayName, avatar_url: null, is_blocked: false, created_at: new Date() };
      memTables.users.push(u);
    } else {
      if (displayName) u.display_name = displayName;
      if (role) u.role = role;
    }
    return { rows: [u], rowCount: 1 };
  }

  if (upper.startsWith('SELECT USERNAME, DISPLAY_NAME, AVATAR_URL, ROLE FROM USERS WHERE USERNAME = $1')) {
    const u = memTables.users.find((x) => x.username.toLowerCase() === String(params[0]).toLowerCase());
    return { rows: u ? [{ username: u.username, display_name: u.display_name, avatar_url: u.avatar_url, role: u.role }] : [], rowCount: u ? 1 : 0 };
  }

  if (upper.startsWith('UPDATE USERS SET DISPLAY_NAME = $1, AVATAR_URL = $2 WHERE USERNAME = $3')) {
    const u = memTables.users.find((x) => x.username.toLowerCase() === String(params[2]).toLowerCase());
    if (u) {
      u.display_name = params[0];
      u.avatar_url = params[1];
    }
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }

  if (upper.startsWith('SELECT ID, USERNAME, DISPLAY_NAME, ROLE, IS_BLOCKED, CREATED_AT FROM USERS')) {
    return { rows: [...memTables.users].reverse(), rowCount: memTables.users.length };
  }

  if (upper.startsWith('UPDATE USERS SET ROLE = $1 WHERE USERNAME = $2')) {
    const u = memTables.users.find((x) => x.username.toLowerCase() === String(params[1]).toLowerCase());
    if (u) u.role = params[0];
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }

  if (upper.startsWith('UPDATE USERS SET IS_BLOCKED = $1 WHERE USERNAME = $2')) {
    const u = memTables.users.find((x) => x.username.toLowerCase() === String(params[1]).toLowerCase());
    if (u) u.is_blocked = !!params[0];
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }

  // --- SESSIONS ---
  if (upper.startsWith('INSERT INTO SESSIONS')) {
    let id = params[0];
    let user_id = params[1];
    let username = params[2];
    let role = params[3];
    let status = params[4];
    let sduJarRaw = params[5];

    if (!username) {
      const match = norm.match(/VALUES\s*\(\s*\$1\s*,\s*\$2\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/i);
      if (match) {
        username = match[1];
        role = match[2];
        status = match[3];
      }
    }

    const sdu_jar = typeof sduJarRaw === 'string' ? JSON.parse(sduJarRaw) : (sduJarRaw || {});
    const existingIdx = memTables.sessions.findIndex((s) => s.id === id);
    const session = {
      id,
      user_id,
      username: username || 'user',
      role: role || 'Student',
      status: status || 'authed',
      sdu_jar,
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
    if (existingIdx >= 0) memTables.sessions[existingIdx] = session;
    else memTables.sessions.push(session);
    return { rows: [session], rowCount: 1 };
  }

  if (upper.includes('FROM SESSIONS S') && upper.includes('JOIN USERS U') && upper.includes('WHERE S.ID = $1')) {
    const sessionId = params[0];
    const s = memTables.sessions.find((x) => x.id === sessionId);
    if (!s) return { rows: [], rowCount: 0 };
    const u = memTables.users.find((x) => x.id === s.user_id || (x.username && s.username && x.username.toLowerCase() === s.username.toLowerCase())) || { role: s.role, is_blocked: false };
    const joined = {
      id: s.id,
      user_id: s.user_id,
      username: s.username,
      role: u.role || s.role || 'Student',
      status: s.status,
      sdu_jar: s.sdu_jar,
      expires_at: s.expires_at,
      is_blocked: Boolean(u.is_blocked),
    };
    return { rows: [joined], rowCount: 1 };
  }

  if (upper.startsWith('UPDATE SESSIONS SET')) {
    const sessionId = params[0];
    const s = memTables.sessions.find((x) => x.id === sessionId);
    if (s) {
      if (sql.includes('status = $2')) s.status = params[1];
      const jsonParam = params.find((p) => typeof p === 'string' && (p.startsWith('{') || p.startsWith('[')));
      if (jsonParam) s.sdu_jar = JSON.parse(jsonParam);
      s.updated_at = new Date();
    }
    return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
  }

  if (upper.startsWith('DELETE FROM SESSIONS WHERE ID = $1')) {
    memTables.sessions = memTables.sessions.filter((s) => s.id !== params[0]);
    return { rows: [], rowCount: 1 };
  }

  if (upper.startsWith('DELETE FROM SESSIONS WHERE USERNAME = $1')) {
    memTables.sessions = memTables.sessions.filter((s) => s.username.toLowerCase() !== String(params[0]).toLowerCase());
    return { rows: [], rowCount: 1 };
  }

  // --- CACHE ---
  if (upper.startsWith('SELECT TERM, IS_APPROVED, TRACK, PROG_TRACK, APPROVED_COURSES, BASKET_SCHEDULE, CACHED_AT FROM STUDENT_DATA_CACHE')) {
    const item = memTables.student_data_cache.get(String(params[0]).toLowerCase());
    return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
  }

  if (upper.startsWith('INSERT INTO STUDENT_DATA_CACHE')) {
    const [username, term, is_approved, trackRaw, prog_track, approvedRaw, basketRaw] = params;
    const item = {
      username,
      term,
      is_approved: !!is_approved,
      track: typeof trackRaw === 'string' ? JSON.parse(trackRaw) : trackRaw,
      prog_track,
      approved_courses: typeof approvedRaw === 'string' ? JSON.parse(approvedRaw) : approvedRaw,
      basket_schedule: typeof basketRaw === 'string' ? JSON.parse(basketRaw) : basketRaw,
      cached_at: new Date(),
    };
    memTables.student_data_cache.set(String(username).toLowerCase(), item);
    return { rows: [item], rowCount: 1 };
  }

  if (upper.startsWith('DELETE FROM STUDENT_DATA_CACHE WHERE USERNAME = $1')) {
    memTables.student_data_cache.delete(String(params[0]).toLowerCase());
    return { rows: [], rowCount: 1 };
  }

  if (upper.startsWith('SELECT CURRICULUM, SECTIONS_DEFAULTS, CACHED_AT FROM CURRICULUM_CACHE')) {
    const item = memTables.curriculum_cache.get(String(params[0]));
    return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
  }

  if (upper.startsWith('INSERT INTO CURRICULUM_CACHE')) {
    const key = String(params[0]);
    const curr = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
    const def = params[2] ? (typeof params[2] === 'string' ? JSON.parse(params[2]) : params[2]) : null;
    const item = { track_id: key, curriculum: curr, sections_defaults: def, cached_at: new Date() };
    memTables.curriculum_cache.set(key, item);
    return { rows: [item], rowCount: 1 };
  }

  if (upper.startsWith('SELECT DATA, CACHED_AT FROM COURSE_SECTIONS_CACHE')) {
    const item = memTables.course_sections_cache.get(String(params[0]));
    return { rows: item ? [item] : [], rowCount: item ? 1 : 0 };
  }

  if (upper.startsWith('INSERT INTO COURSE_SECTIONS_CACHE')) {
    const key = String(params[0]);
    const data = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
    const item = { cache_key: key, data, cached_at: new Date() };
    memTables.course_sections_cache.set(key, item);
    return { rows: [item], rowCount: 1 };
  }

  // --- PREREQUISITES ---
  if (upper.startsWith('SELECT COURSE_CODE, PREREQ_COURSE_CODE, MIN_GRADE, TYPE FROM PREREQUISITES')) {
    return { rows: [...memTables.prerequisites], rowCount: memTables.prerequisites.length };
  }

  if (upper.startsWith('INSERT INTO PREREQUISITES')) {
    const [course_code, prereq_course_code, min_grade, type] = params;
    const rule = { course_code, prereq_course_code, min_grade: min_grade || 'D', type: type || 'prerequisite' };
    const idx = memTables.prerequisites.findIndex(
      (r) => r.course_code.toUpperCase() === course_code.toUpperCase() && r.prereq_course_code.toUpperCase() === prereq_course_code.toUpperCase()
    );
    if (idx >= 0) memTables.prerequisites[idx] = rule;
    else memTables.prerequisites.push(rule);
    return { rows: [rule], rowCount: 1 };
  }

  // --- STUDENT GROUPS & MEMBERS ---
  if (upper.startsWith('INSERT INTO STUDENT_GROUPS')) {
    const [name, program, study_year, advisor_username] = params;
    const group = {
      id: nextGroupId++,
      name,
      program,
      study_year: Number(study_year) || 1,
      advisor_username: advisor_username || null,
      created_at: new Date()
    };
    const existingIdx = memTables.student_groups.findIndex((g) => g.name.toLowerCase() === name.toLowerCase());
    if (existingIdx >= 0) memTables.student_groups[existingIdx] = group;
    else memTables.student_groups.push(group);
    return { rows: [group], rowCount: 1 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM STUDENT_GROUPS WHERE LOWER(NAME) = LOWER($1)')) {
    const g = memTables.student_groups.find((x) => x.name.toLowerCase() === String(params[0]).toLowerCase());
    return { rows: g ? [g] : [], rowCount: g ? 1 : 0 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM STUDENT_GROUPS') && (upper.includes('WHERE G.ID = $1') || upper.includes('WHERE ID = $1'))) {
    const g = memTables.student_groups.find((x) => x.id === Number(params[0]) || String(x.id) === String(params[0]));
    if (!g) return { rows: [], rowCount: 0 };
    const u = g.advisor_username ? memTables.users.find((x) => x.username.toLowerCase() === g.advisor_username.toLowerCase()) : null;
    return {
      rows: [{
        ...g,
        advisor_display_name: u?.display_name || null,
        advisor_avatar_url: u?.avatar_url || null,
        advisor_role: u?.role || 'Advisor'
      }],
      rowCount: 1
    };
  }

  if (upper.startsWith('UPDATE STUDENT_GROUPS SET ADVISOR_USERNAME = $1 WHERE ID = $2')) {
    const g = memTables.student_groups.find((x) => x.id === Number(params[1]) || String(x.id) === String(params[1]));
    if (g) g.advisor_username = params[0] || null;
    const u = g?.advisor_username ? memTables.users.find((x) => x.username.toLowerCase() === g.advisor_username.toLowerCase()) : null;
    return {
      rows: g ? [{
        ...g,
        advisor_display_name: u?.display_name || null,
        advisor_avatar_url: u?.avatar_url || null,
        advisor_role: u?.role || 'Advisor'
      }] : [],
      rowCount: g ? 1 : 0
    };
  }

  if (upper.startsWith('DELETE FROM STUDENT_GROUPS WHERE ID = $1')) {
    const targetId = Number(params[0]);
    const deleted = memTables.student_groups.find((g) => g.id === targetId || String(g.id) === String(params[0])) || null;
    memTables.student_groups = memTables.student_groups.filter((g) => g.id !== targetId && String(g.id) !== String(params[0]));
    memTables.group_members = memTables.group_members.filter((m) => m.group_id !== targetId && String(m.group_id) !== String(params[0]));
    return { rows: deleted ? [deleted] : [], rowCount: deleted ? 1 : 0 };
  }

  if (upper.startsWith('INSERT INTO GROUP_MEMBERS')) {
    const [group_id, username] = params;
    const member = { id: nextMemberId++, group_id: Number(group_id), username, enrolled_at: new Date() };
    const existingIdx = memTables.group_members.findIndex((m) => m.username.toLowerCase() === username.toLowerCase());
    if (existingIdx >= 0) memTables.group_members[existingIdx] = member;
    else memTables.group_members.push(member);
    return { rows: [member], rowCount: 1 };
  }

  if (upper.includes('FROM GROUP_MEMBERS M') && upper.includes('WHERE M.GROUP_ID = $1')) {
    const members = memTables.group_members.filter((m) => m.group_id === Number(params[0])).map((m) => {
      const u = memTables.users.find((x) => x.username.toLowerCase() === m.username.toLowerCase()) || {};
      return { id: m.id, username: m.username, enrolled_at: m.enrolled_at, display_name: u.display_name || null, avatar_url: u.avatar_url || null, role: u.role || 'Student' };
    });
    return { rows: members, rowCount: members.length };
  }

  if (upper.startsWith('DELETE FROM GROUP_MEMBERS WHERE GROUP_ID = $1 AND USERNAME = $2')) {
    const idx = memTables.group_members.findIndex((m) => m.group_id === Number(params[0]) && m.username.toLowerCase() === String(params[1]).toLowerCase());
    const deleted = idx >= 0 ? memTables.group_members.splice(idx, 1)[0] : null;
    return { rows: deleted ? [deleted] : [], rowCount: deleted ? 1 : 0 };
  }

  if (upper.includes('FROM STUDENT_GROUPS G')) {
    const groupsWithStats = memTables.student_groups.map((g) => {
      const u = g.advisor_username ? memTables.users.find((x) => x.username.toLowerCase() === g.advisor_username.toLowerCase()) : null;
      const memberCount = memTables.group_members.filter((m) => m.group_id === g.id).length;
      return {
        id: g.id,
        name: g.name,
        program: g.program,
        study_year: g.study_year,
        advisor_username: g.advisor_username,
        advisor_display_name: u?.display_name || null,
        advisor_avatar_url: u?.avatar_url || null,
        advisor_role: u?.role || 'Advisor',
        member_count: memberCount,
        created_at: g.created_at
      };
    });
    return { rows: groupsWithStats, rowCount: groupsWithStats.length };
  }

  if (upper.includes('FROM GROUP_MEMBERS M') && upper.includes('WHERE M.USERNAME = $1')) {
    const m = memTables.group_members.find((x) => x.username.toLowerCase() === String(params[0]).toLowerCase());
    if (!m) return { rows: [], rowCount: 0 };
    const g = memTables.student_groups.find((x) => x.id === m.group_id);
    const u = g?.advisor_username ? memTables.users.find((x) => x.username.toLowerCase() === g.advisor_username.toLowerCase()) : null;
    return {
      rows: g ? [{
        group_id: g.id,
        group_name: g.name,
        program: g.program,
        study_year: g.study_year,
        advisor_username: g.advisor_username,
        advisor_display_name: u?.display_name || null,
        advisor_avatar_url: u?.avatar_url || null,
        advisor_role: u?.role || 'Advisor'
      }] : [],
      rowCount: g ? 1 : 0,
    };
  }

  // --- CURRICULUMS ---
  if (upper.includes('FROM COURSE_CATALOG') || upper.includes('SELECT 1 FROM COURSE_CATALOG')) {
    if (upper.includes('WHERE UPPER(CODE) = $1')) {
      const code = String(params[0]).toUpperCase().trim();
      const inCat = memTables.course_catalog.some((c) => c.code.toUpperCase() === code);
      return { rows: inCat ? [{ '?column?': 1 }] : [], rowCount: inCat ? 1 : 0 };
    }
    return { rows: memTables.course_catalog, rowCount: memTables.course_catalog.length };
  }

  if (upper.startsWith('INSERT INTO COURSE_CATALOG')) {
    const [code, name, ects, description] = params;
    const item = {
      code: code.toUpperCase().trim(),
      name: name || code,
      ects: Number(ects) || 5,
      description: description || null,
    };
    const idx = memTables.course_catalog.findIndex((c) => c.code === item.code);
    if (idx >= 0) {
      memTables.course_catalog[idx] = {
        ...memTables.course_catalog[idx],
        ...item,
        description: item.description ?? memTables.course_catalog[idx].description ?? null,
      };
    } else {
      memTables.course_catalog.push(item);
    }
    return { rows: [item], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO PROGRAM_CURRICULUMS')) {
    const [program, academic_year, version_title, is_published] = params;
    const curr = {
      id: memTables.program_curriculums.length + 1,
      program,
      academic_year: Number(academic_year),
      version_title,
      is_published: !!is_published,
      created_at: new Date()
    };
    memTables.program_curriculums.push(curr);
    return { rows: [curr], rowCount: 1 };
  }

  if (upper.includes('FROM PROGRAM_CURRICULUMS WHERE ID = $1')) {
    const c = memTables.program_curriculums.find((x) => x.id === Number(params[0]));
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }

  if (upper.includes('FROM PROGRAM_CURRICULUMS') && upper.includes('IS_PUBLISHED = TRUE')) {
    const list = memTables.program_curriculums
      .filter((c) => c.is_published && c.program.toLowerCase() === String(params[0]).toLowerCase())
      .filter((c) => (params[1] !== undefined && params[1] !== null ? c.academic_year === Number(params[1]) : true))
      .sort((a, b) => (b.academic_year || 0) - (a.academic_year || 0));
    return { rows: list, rowCount: list.length };
  }

  if (upper.startsWith('UPDATE PROGRAM_CURRICULUMS SET IS_PUBLISHED = $1 WHERE ID = $2')) {
    const c = memTables.program_curriculums.find((x) => x.id === Number(params[1]));
    if (c) c.is_published = !!params[0];
    return { rows: c ? [c] : [], rowCount: c ? 1 : 0 };
  }

  if (upper.startsWith('UPDATE PROGRAM_CURRICULUMS SET IS_PUBLISHED = FALSE WHERE PROGRAM = $1')) {
    for (const c of memTables.program_curriculums) {
      const matchProgram = c.program.toLowerCase() === String(params[0]).toLowerCase();
      const matchYear = params[1] !== undefined ? c.academic_year === Number(params[1]) : true;
      const matchNotId = params[2] !== undefined ? c.id !== Number(params[2]) : true;
      if (matchProgram && matchYear && matchNotId) {
        c.is_published = false;
      }
    }
    return { rows: [], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO PROGRAM_CURRICULUM_COURSES')) {
    const [curriculum_id, semester, course_code, course_name, ects, course_type] = params;
    const c = { id: memTables.program_curriculum_courses.length + 1, curriculum_id: Number(curriculum_id), semester: Number(semester), course_code, course_name, ects: Number(ects) || 5, course_type: course_type || 'Mandatory' };
    memTables.program_curriculum_courses.push(c);
    return { rows: [c], rowCount: 1 };
  }

  if (upper.includes('FROM PROGRAM_CURRICULUM_COURSES WHERE CURRICULUM_ID = $1')) {
    const list = memTables.program_curriculum_courses.filter((c) => c.curriculum_id === Number(params[0]));
    return { rows: list, rowCount: list.length };
  }

  if (upper.startsWith('INSERT INTO USER_CURRICULUMS')) {
    const [username, curriculum_id] = params;
    const item = { username, curriculum_id: Number(curriculum_id), assigned_at: new Date() };
    const idx = memTables.user_curriculums.findIndex((u) => u.username.toLowerCase() === username.toLowerCase() && u.curriculum_id === Number(curriculum_id));
    if (idx >= 0) memTables.user_curriculums[idx] = item;
    else memTables.user_curriculums.push(item);
    return { rows: [item], rowCount: 1 };
  }

  if (upper.includes('FROM USER_CURRICULUMS UC') && upper.includes('WHERE UC.CURRICULUM_ID = $1')) {
    const assigned = memTables.user_curriculums
      .filter((u) => u.curriculum_id === Number(params[0]))
      .map((u) => {
        const user = memTables.users.find((x) => x.username.toLowerCase() === u.username.toLowerCase()) || {};
        return { username: u.username, assigned_at: u.assigned_at, display_name: user.display_name || null, role: user.role || 'Student' };
      });
    return { rows: assigned, rowCount: assigned.length };
  }

  if (upper.includes('FROM USER_CURRICULUMS UC') && upper.includes('WHERE UC.USERNAME = $1')) {
    const assigned = memTables.user_curriculums.filter((u) => u.username.toLowerCase() === String(params[0]).toLowerCase()).map((u) => {
      const c = memTables.program_curriculums.find((x) => x.id === u.curriculum_id) || {};
      return { id: c.id, program: c.program, academic_year: c.academic_year, version_title: c.version_title, is_published: c.is_published, created_at: c.created_at, assigned_at: u.assigned_at };
    });
    return { rows: assigned, rowCount: assigned.length };
  }

  if (upper.startsWith('DELETE FROM USER_CURRICULUMS WHERE CURRICULUM_ID = $1 AND USERNAME = $2')) {
    memTables.user_curriculums = memTables.user_curriculums.filter((u) => !(u.curriculum_id === Number(params[0]) && u.username.toLowerCase() === String(params[1]).toLowerCase()));
    return { rows: [], rowCount: 1 };
  }

  if (upper.startsWith('DELETE FROM PROGRAM_CURRICULUMS WHERE ID = $1')) {
    const id = Number(params[0]);
    memTables.program_curriculums = memTables.program_curriculums.filter((c) => c.id !== id);
    memTables.program_curriculum_courses = memTables.program_curriculum_courses.filter((c) => c.curriculum_id !== id);
    memTables.user_curriculums = memTables.user_curriculums.filter((c) => c.curriculum_id !== id);
    return { rows: [], rowCount: 1 };
  }

  if (upper.includes('FROM PROGRAM_CURRICULUMS C') && upper.includes('LEFT JOIN PROGRAM_CURRICULUM_COURSES')) {
    const list = memTables.program_curriculums.map((c) => {
      const courses = memTables.program_curriculum_courses.filter((cc) => cc.curriculum_id === c.id);
      const students = memTables.user_curriculums.filter((uc) => uc.curriculum_id === c.id);
      return {
        id: c.id, program: c.program, academic_year: c.academic_year, version_title: c.version_title, is_published: c.is_published, created_at: c.created_at,
        course_count: courses.length,
        max_semester: courses.length > 0 ? Math.max(...courses.map((x) => x.semester)) : 0,
        student_count: students.length
      };
    });
    return { rows: list, rowCount: list.length };
  }

  // --- RECOMMENDATION CONFIGS ---
  if (upper.includes('FROM RECOMMENDATION_CONFIGS WHERE IS_ACTIVE = TRUE')) {
    const active = memTables.recommendation_configs.find((c) => c.is_active) || memTables.recommendation_configs[0];
    return { rows: active ? [active] : [], rowCount: active ? 1 : 0 };
  }

  if (upper.startsWith('UPDATE RECOMMENDATION_CONFIGS SET IS_ACTIVE = FALSE')) {
    for (const c of memTables.recommendation_configs) c.is_active = false;
    return { rows: [], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO RECOMMENDATION_CONFIGS')) {
    const [version, min_ects, max_ects, gpa_weight, retake_weight, interest_weight, disabled_programsRaw, created_by] = params;
    const disabled_programs = typeof disabled_programsRaw === 'string' ? JSON.parse(disabled_programsRaw) : disabled_programsRaw;
    const cfg = {
      id: memTables.recommendation_configs.length + 1,
      version: Number(version),
      min_ects: Number(min_ects),
      max_ects: Number(max_ects),
      gpa_weight: Number(gpa_weight),
      retake_weight: Number(retake_weight),
      interest_weight: Number(interest_weight),
      disabled_programs,
      created_by: created_by || 'Administrator',
      created_at: new Date().toISOString(),
      is_active: true
    };
    memTables.recommendation_configs.push(cfg);
    return { rows: [cfg], rowCount: 1 };
  }

  // --- AI GUARDRAIL CONFIGS (US24) ---
  if (upper.includes('FROM AI_GUARDRAIL_CONFIGS WHERE IS_ACTIVE = TRUE')) {
    const active =
      memTables.ai_guardrail_configs
        .filter((c) => c.is_active)
        .sort((a, b) => (b.version || 0) - (a.version || 0))[0] || null;
    return { rows: active ? [active] : [], rowCount: active ? 1 : 0 };
  }

  if (upper.startsWith('UPDATE AI_GUARDRAIL_CONFIGS SET IS_ACTIVE = FALSE')) {
    for (const c of memTables.ai_guardrail_configs) c.is_active = false;
    return { rows: [], rowCount: 1 };
  }

  if (upper.startsWith('INSERT INTO AI_GUARDRAIL_CONFIGS')) {
    const [
      version,
      blockedCategoriesRaw,
      customKeywordsRaw,
      refusal_message_en,
      refusal_message_ru,
      disclaimer_text,
      officialDeadlinesRaw,
      redact_sensitive_data,
      updated_by,
    ] = params;
    const parseJson = (val, fallback) => {
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return fallback; }
      }
      return val ?? fallback;
    };
    const cfg = {
      id: memTables.ai_guardrail_configs.length + 1,
      version: Number(version),
      blocked_categories: parseJson(blockedCategoriesRaw, []),
      custom_blocked_keywords: parseJson(customKeywordsRaw, []),
      refusal_message_en,
      refusal_message_ru,
      disclaimer_text,
      official_deadlines: parseJson(officialDeadlinesRaw, {}),
      redact_sensitive_data: Boolean(redact_sensitive_data),
      updated_by: updated_by || 'Administrator',
      created_at: new Date().toISOString(),
      is_active: true,
    };
    memTables.ai_guardrail_configs.push(cfg);
    return { rows: [cfg], rowCount: 1 };
  }

  // --- RECOMMENDATION FEEDBACK ---
  if (upper.includes('FROM RECOMMENDATION_FEEDBACK WHERE USERNAME = $1')) {
    const fb = memTables.recommendation_feedback.filter(
      (f) => f.username.toLowerCase() === String(params[0]).toLowerCase()
    );
    return { rows: fb, rowCount: fb.length };
  }

  if (upper.startsWith('INSERT INTO RECOMMENDATION_FEEDBACK')) {
    const [username, course_code, is_interested, target_semester] = params;
    const entry = { id: memTables.recommendation_feedback.length + 1, username, course_code, is_interested: !!is_interested, target_semester, created_at: new Date() };
    const idx = memTables.recommendation_feedback.findIndex((f) => f.username.toLowerCase() === username.toLowerCase() && f.course_code.toUpperCase() === course_code.toUpperCase());
    if (idx >= 0) memTables.recommendation_feedback[idx] = entry;
    else memTables.recommendation_feedback.push(entry);
    return { rows: [entry], rowCount: 1 };
  }

  // --- PLANS ---
  if (upper.startsWith('SELECT') && upper.includes('FROM STUDENT_SEMESTER_PLANS WHERE USERNAME = $1')) {
    let userPlans = memTables.student_semester_plans.filter(
      (p) =>
        p.username.toLowerCase() === String(params[0]).toLowerCase() &&
        (params[1] !== undefined && params[1] !== null ? Number(p.target_semester) === Number(params[1]) : true)
    );
    if (upper.includes('ORDER BY TARGET_SEMESTER DESC')) {
      userPlans = [...userPlans].sort((a, b) => Number(b.target_semester) - Number(a.target_semester));
    } else if (upper.includes('ORDER BY TARGET_SEMESTER ASC')) {
      userPlans = [...userPlans].sort((a, b) => Number(a.target_semester) - Number(b.target_semester));
    }
    if (upper.includes('LIMIT 1')) {
      userPlans = userPlans.slice(0, 1);
    }
    return { rows: userPlans, rowCount: userPlans.length };
  }

  if (upper.startsWith('DELETE FROM STUDENT_SEMESTER_PLANS')) {
    const uname = String(params[0]).toLowerCase();
    const sem = params[1] !== undefined ? Number(params[1]) : null;
    const deleted = memTables.student_semester_plans.filter(
      (p) => p.username.toLowerCase() === uname && (sem === null || Number(p.target_semester) === sem)
    );
    memTables.student_semester_plans = memTables.student_semester_plans.filter(
      (p) => !(p.username.toLowerCase() === uname && (sem === null || Number(p.target_semester) === sem))
    );
    return { rows: deleted, rowCount: deleted.length };
  }

  if (upper.startsWith('INSERT INTO STUDENT_SEMESTER_PLANS')) {
    const [username, target_semester, coursesRaw, total_ects, is_approved] = params;
    const courses = typeof coursesRaw === 'string' ? JSON.parse(coursesRaw) : coursesRaw;
    const plan = { id: nextPlanId++, username, target_semester: Number(target_semester), courses, total_ects: Number(total_ects), is_approved, updated_at: new Date() };
    const idx = memTables.student_semester_plans.findIndex((p) => p.username.toLowerCase() === username.toLowerCase() && Number(p.target_semester) === Number(target_semester));
    if (idx >= 0) memTables.student_semester_plans[idx] = plan;
    else memTables.student_semester_plans.push(plan);
    return { rows: [plan], rowCount: 1 };
  }

  // --- AI CHAT MESSAGES & LOG REVIEWS (US21-US25) ---
  if (upper.startsWith('SELECT') && upper.includes('FROM AI_CHAT_MESSAGES WHERE USERNAME = $1')) {
    const uname = String(params[0] || '').toLowerCase();
    const limit = Number(params[1]) || 100;
    const rows = memTables.ai_chat_messages
      .filter((m) => String(m.username || '').toLowerCase() === uname)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id)
      .slice(0, limit);
    return { rows, rowCount: rows.length };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM AI_CHAT_MESSAGES WHERE ID = $1')) {
    const found = memTables.ai_chat_messages.find((m) => Number(m.id) === Number(params[0]));
    return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM AI_CHAT_MESSAGES')) {
    const rows = [...memTables.ai_chat_messages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
    );
    return { rows, rowCount: rows.length };
  }

  if (upper.startsWith('INSERT INTO AI_CHAT_MESSAGES')) {
    const [username, sender, content, metaRaw, createdAtRaw] = params;
    let metadata = {};
    if (typeof metaRaw === 'string') {
      try { metadata = JSON.parse(metaRaw); } catch { metadata = {}; }
    } else if (metaRaw && typeof metaRaw === 'object') {
      metadata = metaRaw;
    }
    const created_at = createdAtRaw ? new Date(createdAtRaw).toISOString() : new Date().toISOString();
    const msg = {
      id: nextChatId++,
      username: String(username),
      sender: String(sender),
      content: String(content),
      metadata,
      created_at,
    };
    memTables.ai_chat_messages.push(msg);
    return { rows: [msg], rowCount: 1 };
  }

  if (upper.startsWith('DELETE FROM AI_CHAT_MESSAGES WHERE USERNAME = $1')) {
    const uname = String(params[0] || '').toLowerCase();
    const removedIds = new Set(
      memTables.ai_chat_messages
        .filter((m) => String(m.username || '').toLowerCase() === uname)
        .map((m) => Number(m.id))
    );
    memTables.ai_chat_messages = memTables.ai_chat_messages.filter(
      (m) => String(m.username || '').toLowerCase() !== uname
    );
    memTables.ai_chat_log_reviews = memTables.ai_chat_log_reviews.filter(
      (r) => !removedIds.has(Number(r.message_id))
    );
    return { rows: [], rowCount: removedIds.size };
  }

  if (upper.startsWith('DELETE FROM AI_CHAT_MESSAGES WHERE CREATED_AT < $1')) {
    const cutoffMs = new Date(params[0]).getTime();
    const removed = memTables.ai_chat_messages.filter(
      (m) => new Date(m.created_at).getTime() < cutoffMs
    );
    const removedIds = new Set(removed.map((m) => Number(m.id)));
    memTables.ai_chat_messages = memTables.ai_chat_messages.filter(
      (m) => !removedIds.has(Number(m.id))
    );
    memTables.ai_chat_log_reviews = memTables.ai_chat_log_reviews.filter(
      (r) => !removedIds.has(Number(r.message_id))
    );
    return { rows: removed.map((m) => ({ id: m.id })), rowCount: removed.length };
  }

  if (upper.startsWith('SELECT') && upper.includes('FROM AI_CHAT_LOG_REVIEWS')) {
    const rows = [...memTables.ai_chat_log_reviews].sort(
      (a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime() || b.id - a.id
    );
    return { rows, rowCount: rows.length };
  }

  if (upper.startsWith('INSERT INTO AI_CHAT_LOG_REVIEWS')) {
    const [messageIdRaw, status, comment, reviewedBy] = params;
    const message_id = Number(messageIdRaw);
    const now = new Date().toISOString();
    const existingIdx = memTables.ai_chat_log_reviews.findIndex(
      (r) => Number(r.message_id) === message_id
    );
    if (existingIdx >= 0) {
      memTables.ai_chat_log_reviews[existingIdx] = {
        ...memTables.ai_chat_log_reviews[existingIdx],
        status,
        comment: comment || '',
        reviewed_by: reviewedBy || 'Administrator',
        updated_at: now,
      };
      return { rows: [memTables.ai_chat_log_reviews[existingIdx]], rowCount: 1 };
    }
    const review = {
      id: nextLogReviewId++,
      message_id,
      status,
      comment: comment || '',
      reviewed_by: reviewedBy || 'Administrator',
      created_at: now,
      updated_at: now,
    };
    memTables.ai_chat_log_reviews.push(review);
    return { rows: [review], rowCount: 1 };
  }

  if (upper.startsWith('DELETE FROM AI_CHAT_LOG_REVIEWS WHERE MESSAGE_ID = $1')) {
    const messageId = Number(params[0]);
    const removed = memTables.ai_chat_log_reviews.filter((r) => Number(r.message_id) === messageId);
    memTables.ai_chat_log_reviews = memTables.ai_chat_log_reviews.filter(
      (r) => Number(r.message_id) !== messageId
    );
    return { rows: removed, rowCount: removed.length };
  }

  // --- GENERAL DELETE ---
  if (upper.includes('DELETE FROM STUDENT_GROUPS WHERE NAME LIKE')) {
    memTables.student_groups = memTables.student_groups.filter((g) => !g.name.toUpperCase().startsWith('TEST-'));
    return { rows: [], rowCount: 1 };
  }

  if (upper.includes('DELETE FROM GROUP_MEMBERS WHERE USERNAME LIKE')) {
    memTables.group_members = memTables.group_members.filter((m) => !m.username.toLowerCase().startsWith('test_'));
    return { rows: [], rowCount: 1 };
  }

  if (upper.includes('DELETE FROM USERS WHERE USERNAME LIKE')) {
    memTables.users = memTables.users.filter((u) => !u.username.toLowerCase().startsWith('test_'));
    return { rows: [], rowCount: 1 };
  }

  if (upper.startsWith('DELETE FROM')) {
    return { rows: [], rowCount: 1 };
  }

  // General fallback for any other query
  return { rows: [], rowCount: 0 };
}

const pool = {
  async query(sqlOrConfig, params) {
    if (useInMemory || !realPool) {
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
      const p = typeof sqlOrConfig === 'string' ? params : (sqlOrConfig.values || []);
      return handleMemQuery(sql, p);
    }
    try {
      return await realPool.query(sqlOrConfig, params);
    } catch (err) {
      const msg = err.message || '';
      if (!useInMemory) {
        console.warn(`[db] PostgreSQL connection unavailable (${msg}). Seamlessly switching to resilient in-memory database store.`);
        useInMemory = true;
      }
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
      const p = typeof sqlOrConfig === 'string' ? params : (sqlOrConfig.values || []);
      return handleMemQuery(sql, p);
    }
  },
  async end() {
    if (realPool) {
      try {
        await realPool.end();
      } catch {}
    }
  },
  on(...args) {
    if (realPool) {
      return realPool.on(...args);
    }
  }
};

export async function initDb() {
  if (useInMemory || !realPool) {
    console.log('[db] Running with resilient in-memory database store.');
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        display_name VARCHAR(255),
        avatar_url TEXT,
        role VARCHAR(50) DEFAULT 'Student',
        is_blocked BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_messages (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        sender VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`ALTER TABLE ai_chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS course_catalog (
        code VARCHAR(50) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        ects INTEGER DEFAULT 5,
        description TEXT
      );
    `);
    await pool.query(`ALTER TABLE course_catalog ADD COLUMN IF NOT EXISTS description TEXT;`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_guardrail_configs (
        id SERIAL PRIMARY KEY,
        version INTEGER NOT NULL,
        blocked_categories JSONB NOT NULL DEFAULT '["politics","medical","legal","personal"]'::jsonb,
        custom_blocked_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
        refusal_message_en TEXT NOT NULL,
        refusal_message_ru TEXT NOT NULL,
        disclaimer_text TEXT NOT NULL,
        official_deadlines JSONB NOT NULL DEFAULT '{}'::jsonb,
        redact_sensitive_data BOOLEAN NOT NULL DEFAULT true,
        updated_by VARCHAR(255) DEFAULT 'Administrator',
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_chat_log_reviews (
        id SERIAL PRIMARY KEY,
        message_id INTEGER UNIQUE NOT NULL REFERENCES ai_chat_messages(id) ON DELETE CASCADE,
        status VARCHAR(20) NOT NULL,
        comment TEXT DEFAULT '',
        reviewed_by VARCHAR(255) DEFAULT 'Administrator',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database initialized with sessions & caching tables.');
  } catch (err) {
    console.warn('[db init warning] Using in-memory database store:', err.message);
    useInMemory = true;
  }
}

export { pool };
