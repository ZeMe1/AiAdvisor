import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const { Pool } = pg;

if (fs.existsSync('.env.cloud')) {
  dotenv.config({ path: '.env.cloud' });
} else {
  dotenv.config();
}

const connectionString = process.env.DATABASE_URL;

const rawPool = new Pool(connectionString ? {
  connectionString,
  ssl: { rejectUnauthorized: false }
} : {
  user: process.env.PGUSER || 'postgres',
  host: process.env.PGHOST || '127.0.0.1',
  database: process.env.PGDATABASE || 'aiadvisor',
  password: process.env.PGPASSWORD || 'postgres',
  port: Number(process.env.PGPORT) || 5432,
});

rawPool.on('error', (err) => {
  // Suppress uncaught error events so process does not terminate
  console.error('[db] pg pool error:', err.message);
});

let usePg = false;

// ------------------------------------------------- Local File Storage Fallback
const DATA_DIR = path.resolve('.data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initialData = {
      users: [
        {
          id: 1,
          username: '240103199',
          password_hash: '$2b$10$dummyHashForAdminLocalTestingOnly',
          display_name: 'Dulat',
          avatar_url: '',
          role: 'Administrator',
          is_blocked: false,
          created_at: new Date().toISOString()
        }
      ],
      courses: []
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
  }
}

function readData() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.users) parsed.users = [];
    if (!parsed.courses) parsed.courses = [];
    if (!parsed.prerequisites) parsed.prerequisites = [];
    if (!parsed.transcripts) parsed.transcripts = [];
    return parsed;
  } catch {
    return { users: [], courses: [] };
  }
}

function writeData(data) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function executeFallback(sql, params = []) {
  const norm = sql.trim().replace(/\s+/g, ' ');
  const data = readData();

  // 1. SELECT * FROM users WHERE username = $1
  if (/^SELECT \* FROM users WHERE username = \$1/i.test(norm)) {
    const username = String(params[0]);
    const user = data.users.find(u => u.username === username);
    return { rows: user ? [{ ...user }] : [] };
  }

  // 1b. SELECT * FROM users (all)
  if (/^SELECT \* FROM users/i.test(norm)) {
    return { rows: data.users.map(u => ({ ...u })) };
  }

  // 2. INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING *
  if (/^INSERT INTO users \(username, password_hash\) VALUES/i.test(norm)) {
    const username = String(params[0]);
    const password_hash = String(params[1]);
    const existing = data.users.find(u => u.username === username);
    if (existing) {
      const err = new Error('duplicate key value violates unique constraint "users_username_key"');
      err.code = '23505';
      throw err;
    }
    const maxId = data.users.reduce((m, u) => Math.max(m, u.id || 0), 0);
    // Student 240103199 is elevated to Administrator by default for testing
    const role = username === '240103199' ? 'Administrator' : 'Student';
    const newUser = {
      id: maxId + 1,
      username,
      password_hash,
      display_name: null,
      avatar_url: null,
      role,
      is_blocked: false,
      created_at: new Date().toISOString()
    };
    data.users.push(newUser);
    writeData(data);
    return { rows: [{ ...newUser }] };
  }

  // 3. INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
  if (/^INSERT INTO users \(username, password_hash, role\) VALUES/i.test(norm)) {
    const username = String(params[0]);
    const password_hash = String(params[1]);
    const role = String(params[2]);
    const maxId = data.users.reduce((m, u) => Math.max(m, u.id || 0), 0);
    const newUser = {
      id: maxId + 1,
      username,
      password_hash,
      display_name: null,
      avatar_url: null,
      role,
      is_blocked: false,
      created_at: new Date().toISOString()
    };
    data.users.push(newUser);
    writeData(data);
    return { rows: [{ ...newUser }] };
  }

  // 4. SELECT username, display_name, avatar_url, role FROM users WHERE username = $1
  if (/^SELECT username, display_name, avatar_url, role FROM users WHERE username = \$1/i.test(norm)) {
    const username = String(params[0]);
    const user = data.users.find(u => u.username === username);
    if (!user) return { rows: [] };
    return {
      rows: [{
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role
      }]
    };
  }

  // 5. UPDATE users SET display_name = $1, avatar_url = $2 WHERE username = $3 RETURNING ...
  if (/^UPDATE users SET display_name = \$1, avatar_url = \$2 WHERE username = \$3/i.test(norm)) {
    const [display_name, avatar_url, username] = params;
    const user = data.users.find(u => u.username === String(username));
    if (!user) return { rows: [] };
    user.display_name = display_name;
    user.avatar_url = avatar_url;
    writeData(data);
    return {
      rows: [{
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
        role: user.role
      }]
    };
  }

  // 6. SELECT id, username, display_name, role, is_blocked, created_at FROM users
  if (/^SELECT id, username, display_name, role, is_blocked, created_at FROM users/i.test(norm)) {
    const sorted = [...data.users].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: sorted };
  }

  // 7. UPDATE users SET role = $1 WHERE username = $2 RETURNING id, username, role
  if (/^UPDATE users SET role = \$1 WHERE username = \$2/i.test(norm)) {
    const [role, username] = params;
    const user = data.users.find(u => u.username === String(username));
    if (!user) return { rows: [] };
    user.role = role;
    writeData(data);
    return { rows: [{ id: user.id, username: user.username, role: user.role }] };
  }

  // 8. UPDATE users SET is_blocked = $1 WHERE username = $2 RETURNING id, username, is_blocked
  if (/^UPDATE users SET is_blocked = \$1 WHERE username = \$2/i.test(norm)) {
    const [is_blocked, username] = params;
    const user = data.users.find(u => u.username === String(username));
    if (!user) return { rows: [] };
    user.is_blocked = !!is_blocked;
    writeData(data);
    return { rows: [{ id: user.id, username: user.username, is_blocked: user.is_blocked }] };
  }

  // 9. SELECT * FROM courses ORDER BY is_archived ASC, code ASC
  if (/^SELECT \* FROM courses/i.test(norm)) {
    const sorted = [...data.courses].sort((a, b) => {
      if (a.is_archived !== b.is_archived) return a.is_archived ? 1 : -1;
      return (a.code || '').localeCompare(b.code || '');
    });
    return { rows: sorted };
  }

  // 10. INSERT INTO courses
  if (/^INSERT INTO courses/i.test(norm)) {
    let code, name, credits, description, language, semester, theory_teacher, practice_teacher, quota;
    if (params.length >= 10) {
      // [code, name, credits, description, language, semester, teacher, theory_teacher, practice_teacher, quota]
      [code, name, credits, description, language, semester, , theory_teacher, practice_teacher, quota] = params;
    } else if (params.length === 9) {
      [code, name, credits, description, language, semester, theory_teacher, practice_teacher, quota] = params;
    } else {
      [code, name, credits, description, language, semester, theory_teacher, quota] = params;
      practice_teacher = theory_teacher;
    }

    const normalizedCode = String(code).trim().toUpperCase();
    if (data.courses.some(c => (c.code || '').toUpperCase() === normalizedCode)) {
      const err = new Error('Course code must be unique');
      err.code = '23505';
      throw err;
    }
    const maxId = data.courses.reduce((m, c) => Math.max(m, c.id || 0), 0);
    const newCourse = {
      id: maxId + 1,
      code: normalizedCode,
      name: String(name).trim(),
      credits: Number(credits) || 5,
      description: String(description || '').trim(),
      language: String(language || 'English').trim(),
      semester: String(semester || '').trim(),
      teacher: String(theory_teacher || '').trim(),
      theory_teacher: String(theory_teacher || '').trim(),
      practice_teacher: String(practice_teacher || theory_teacher || '').trim(),
      quota: Number(quota) || 30,
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    data.courses.push(newCourse);
    writeData(data);
    return { rows: [{ ...newCourse }] };
  }

  // 11. UPDATE courses
  if (/^UPDATE courses\b/i.test(norm)) {
    if (/SET is_archived =/i.test(norm)) {
      const [is_archived, id] = params;
      const targetId = Number(id);
      const course = data.courses.find(c => c.id === targetId);
      if (!course) return { rows: [] };
      course.is_archived = !!is_archived;
      course.updated_at = new Date().toISOString();
      writeData(data);
      return { rows: [{ ...course }] };
    } else {
      let code, name, credits, description, language, semester, theory_teacher, practice_teacher, quota, id;
      if (params.length >= 11) {
        // [code, name, credits, description, language, semester, teacher, theory_teacher, practice_teacher, quota, id]
        [code, name, credits, description, language, semester, , theory_teacher, practice_teacher, quota, id] = params;
      } else if (params.length === 10) {
        [code, name, credits, description, language, semester, theory_teacher, practice_teacher, quota, id] = params;
      } else {
        [code, name, credits, description, language, semester, theory_teacher, quota, id] = params;
        practice_teacher = theory_teacher;
      }

      const targetId = Number(id);
      const course = data.courses.find(c => c.id === targetId);
      if (!course) return { rows: [] };

      const normalizedCode = String(code).trim().toUpperCase();
      if (data.courses.some(c => c.id !== targetId && (c.code || '').toUpperCase() === normalizedCode)) {
        const err = new Error('Course code must be unique');
        err.code = '23505';
        throw err;
      }

      course.code = normalizedCode;
      course.name = String(name).trim();
      course.credits = Number(credits) || 5;
      course.description = String(description || '').trim();
      course.language = String(language || 'English').trim();
      course.semester = String(semester || '').trim();
      course.teacher = String(theory_teacher || '').trim();
      course.theory_teacher = String(theory_teacher || '').trim();
      course.practice_teacher = String(practice_teacher || theory_teacher || '').trim();
      course.quota = Number(quota) || 30;
      course.updated_at = new Date().toISOString();
      writeData(data);
      return { rows: [{ ...course }] };
    }
  }

  // 12. DELETE FROM courses
  if (/^DELETE FROM courses WHERE id = \$1/i.test(norm)) {
    const targetId = Number(params[0]);
    const idx = data.courses.findIndex(c => c.id === targetId);
    if (idx === -1) return { rows: [] };
    const [deleted] = data.courses.splice(idx, 1);
    writeData(data);
    return { rows: [{ ...deleted }] };
  }

  // 13. Public catalog: courses WHERE is_archived = false
  if (/^SELECT .* FROM courses WHERE is_archived = false/i.test(norm)) {
    const filtered = data.courses
      .filter(c => !c.is_archived)
      .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    return { rows: filtered };
  }

  // 14. Prerequisites
  if (/^SELECT \* FROM prerequisites/i.test(norm)) {
    return { rows: (data.prerequisites || []).map(p => ({ ...p })) };
  }

  if (/^INSERT INTO prerequisites/i.test(norm)) {
    const [course_code, prereq_code, min_grade, type] = params;
    const cCode = String(course_code).trim().toUpperCase();
    const pCode = String(prereq_code).trim().toUpperCase();
    if (!data.prerequisites) data.prerequisites = [];
    const exists = data.prerequisites.some(p => p.course_code === cCode && p.prereq_code === pCode);
    if (exists) {
      const err = new Error('Prerequisite link already exists');
      err.code = '23505';
      throw err;
    }
    const maxId = data.prerequisites.reduce((m, p) => Math.max(m, p.id || 0), 0);
    const newPrereq = {
      id: maxId + 1,
      course_code: cCode,
      prereq_code: pCode,
      min_grade: String(min_grade || 'C').trim(),
      type: String(type || 'prerequisite').trim(),
      created_at: new Date().toISOString()
    };
    data.prerequisites.push(newPrereq);
    writeData(data);
    return { rows: [{ ...newPrereq }] };
  }

  if (/^DELETE FROM prerequisites WHERE id = \$1/i.test(norm)) {
    const targetId = Number(params[0]);
    if (!data.prerequisites) data.prerequisites = [];
    const idx = data.prerequisites.findIndex(p => p.id === targetId);
    if (idx === -1) return { rows: [] };
    const [deleted] = data.prerequisites.splice(idx, 1);
    writeData(data);
    return { rows: [{ ...deleted }] };
  }

  // ----------------- student_transcripts queries (Story 9) -----------------
  if (/^SELECT \* FROM student_transcripts WHERE username = \$1/i.test(norm)) {
    const username = String(params[0]);
    if (!data.transcripts) data.transcripts = [];
    const list = data.transcripts.filter(t => t.username === username);
    return { rows: list.map(t => ({ ...t })) };
  }

  if (/^INSERT INTO student_transcripts/i.test(norm)) {
    if (!data.transcripts) data.transcripts = [];
    const [username, course_code, course_name, credits, grade, gpa_points, semester] = params;
    const normCode = String(course_code).trim().toUpperCase();
    const existingIdx = data.transcripts.findIndex(t => t.username === String(username) && t.course_code === normCode);

    const record = {
      id: existingIdx >= 0 ? data.transcripts[existingIdx].id : (data.transcripts.reduce((m, x) => Math.max(m, x.id || 0), 0) + 1),
      username: String(username),
      course_code: normCode,
      course_name: String(course_name || normCode),
      credits: Number(credits) || 5,
      grade: String(grade).toUpperCase(),
      gpa_points: Number(gpa_points) || 0,
      semester: String(semester || 'Completed'),
      created_at: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      data.transcripts[existingIdx] = record;
    } else {
      data.transcripts.push(record);
    }
    writeData(data);
    return { rows: [{ ...record }] };
  }

  if (/^DELETE FROM student_transcripts WHERE id = \$1 AND username = \$2/i.test(norm)) {
    const [id, username] = params;
    if (!data.transcripts) data.transcripts = [];
    const idx = data.transcripts.findIndex(t => t.id === Number(id) && t.username === String(username));
    if (idx === -1) return { rows: [] };
    const [deleted] = data.transcripts.splice(idx, 1);
    writeData(data);
    return { rows: [{ ...deleted }] };
  }

  if (/^DELETE FROM student_transcripts WHERE username = \$1/i.test(norm)) {
    const username = String(params[0]);
    if (!data.transcripts) data.transcripts = [];
    const beforeCount = data.transcripts.length;
    data.transcripts = data.transcripts.filter(t => t.username !== username);
    writeData(data);
    return { rows: [{ count: beforeCount - data.transcripts.length }] };
  }

  return { rows: [] };
}

// ------------------------------------------------- Public Database API
export const pool = {
  async query(sql, params = []) {
    if (usePg) {
      try {
        return await rawPool.query(sql, params);
      } catch (err) {
        // If Postgres fails at runtime, fallback seamlessly to prevent 502 Bad Gateway
        console.warn('[db] PostgreSQL runtime query failed, falling back to local storage:', err.message);
        return executeFallback(sql, params);
      }
    }
    return executeFallback(sql, params);
  }
};

export async function initDb() {
  try {
    // Test PostgreSQL connectivity
    await rawPool.query('SELECT 1');
    usePg = true;

    await rawPool.query(`
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

      ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        username VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        status VARCHAR(50) NOT NULL,
        sdu_jar JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS student_data_cache (
        username VARCHAR(255) PRIMARY KEY,
        term VARCHAR(100),
        is_approved BOOLEAN DEFAULT false,
        track JSONB,
        prog_track VARCHAR(50),
        approved_courses JSONB DEFAULT '[]'::jsonb,
        basket_schedule JSONB DEFAULT '[]'::jsonb,
        cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS curriculum_cache (
        track_id VARCHAR(50) PRIMARY KEY,
        curriculum JSONB NOT NULL,
        sections_defaults JSONB,
        cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS course_sections_cache (
        cache_key VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL,
        cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS courses (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        credits INTEGER NOT NULL DEFAULT 5,
        description TEXT DEFAULT '',
        language VARCHAR(50) DEFAULT 'English',
        semester VARCHAR(50) DEFAULT '',
        teacher VARCHAR(255) DEFAULT '',
        quota INTEGER DEFAULT 30,
        is_archived BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS teacher VARCHAR(255) DEFAULT '';
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS theory_teacher VARCHAR(255) DEFAULT '';
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS practice_teacher VARCHAR(255) DEFAULT '';
      ALTER TABLE courses ADD COLUMN IF NOT EXISTS quota INTEGER DEFAULT 30;

      CREATE TABLE IF NOT EXISTS prerequisites (
        id SERIAL PRIMARY KEY,
        course_code VARCHAR(50) NOT NULL,
        prereq_code VARCHAR(50) NOT NULL,
        min_grade VARCHAR(10) DEFAULT 'C',
        type VARCHAR(20) DEFAULT 'prerequisite',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_prereq_link UNIQUE (course_code, prereq_code)
      );

      CREATE TABLE IF NOT EXISTS student_transcripts (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        course_code VARCHAR(50) NOT NULL,
        course_name VARCHAR(255) DEFAULT '',
        credits NUMERIC DEFAULT 5,
        grade VARCHAR(10) NOT NULL,
        gpa_points NUMERIC DEFAULT 0,
        semester VARCHAR(50) DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_student_course UNIQUE (username, course_code)
      );
      CREATE INDEX IF NOT EXISTS idx_transcripts_username ON student_transcripts(username);
      CREATE INDEX IF NOT EXISTS idx_transcripts_course ON student_transcripts(course_code);
    `);

    console.log('[db] PostgreSQL connected and tables initialized with sessions & caching.');
  } catch (err) {
    usePg = false;
    ensureDataFile();
    console.warn(`[db] PostgreSQL not accessible (${err.message}). Using local JSON storage (.data/db.json).`);
  }
}
