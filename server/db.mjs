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

const pool = new Pool(connectionString ? {
  connectionString,
  ssl: { rejectUnauthorized: false }
} : {
  user: 'postgres',
  host: '127.0.0.1',
  database: 'aiadvisor',
  password: '',
  port: 5432,
});

export async function initDb() {
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
      track_id VARCHAR(255) PRIMARY KEY,
      curriculum JSONB NOT NULL,
      sections_defaults JSONB,
      cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    ALTER TABLE curriculum_cache ALTER COLUMN track_id TYPE VARCHAR(255);

    CREATE TABLE IF NOT EXISTS course_sections_cache (
      cache_key VARCHAR(255) PRIMARY KEY,
      data JSONB NOT NULL,
      cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS prerequisites (
      id SERIAL PRIMARY KEY,
      course_code VARCHAR(32) NOT NULL,
      prereq_course_code VARCHAR(32) NOT NULL,
      min_grade VARCHAR(8) DEFAULT 'D',
      type VARCHAR(16) DEFAULT 'prerequisite',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(course_code, prereq_course_code)
    );
    CREATE INDEX IF NOT EXISTS idx_prereq_course ON prerequisites(course_code);

    CREATE TABLE IF NOT EXISTS student_groups (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) UNIQUE NOT NULL,
      program VARCHAR(255) NOT NULL,
      study_year INTEGER NOT NULL DEFAULT 1,
      advisor_username VARCHAR(255) REFERENCES users(username) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES student_groups(id) ON DELETE CASCADE,
      username VARCHAR(255) UNIQUE NOT NULL,
      enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_username ON group_members(username);

    CREATE TABLE IF NOT EXISTS course_catalog (
      code VARCHAR(50) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      ects INT NOT NULL DEFAULT 5,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS program_curriculums (
      id SERIAL PRIMARY KEY,
      program VARCHAR(255) NOT NULL,
      academic_year INT NOT NULL,
      version_title VARCHAR(255) NOT NULL,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_curriculums_lookup ON program_curriculums(program, academic_year, is_published);

    CREATE TABLE IF NOT EXISTS program_curriculum_courses (
      id SERIAL PRIMARY KEY,
      curriculum_id INT NOT NULL REFERENCES program_curriculums(id) ON DELETE CASCADE,
      semester INT NOT NULL,
      course_code VARCHAR(50) NOT NULL,
      course_name VARCHAR(255) NOT NULL,
      ects INT NOT NULL DEFAULT 5,
      course_type VARCHAR(50) NOT NULL DEFAULT 'Mandatory'
    );
    CREATE INDEX IF NOT EXISTS idx_curr_courses_curriculum ON program_curriculum_courses(curriculum_id);

    -- Seed standard course catalog if empty
    INSERT INTO course_catalog (code, name, ects)
    VALUES
      ('CSS 105', 'Fundamentals of Programming', 5),
      ('CSS 108', 'Programming Technologies', 5),
      ('CSS 215', 'Data Structures & Algorithms', 5),
      ('CSS 216', 'Mobile Application Development', 5),
      ('CSS 280', 'Web Development Basics', 5),
      ('CSS 305', 'Database Systems', 5),
      ('CSS 311', 'Operating Systems', 5),
      ('CSS 320', 'Software Engineering', 5),
      ('CSS 405', 'Artificial Intelligence', 5),
      ('INF 318', 'Computer Networks', 5),
      ('INF 376', 'Information Security', 5),
      ('INF 451', 'Cloud Computing & DevOps', 5),
      ('MAT 137', 'Mathematics 1', 5),
      ('MAT 138', 'Mathematics 2', 5),
      ('MDE 162', 'Academic English 1', 3),
      ('MDE 171', 'Academic English 2', 3),
      ('MDE 291', 'Philosophy', 3),
      ('MDE 292', 'Sociology & Social Science', 3),
      ('MDE 293', 'Kazakh Language 1', 3),
      ('MDE 294', 'Kazakh Language 2', 3),
      ('CS 101', 'Introduction to Computer Science', 5),
      ('CS 201', 'Intermediate Programming', 5),
      ('CS 301', 'Algorithms and Complexity', 5),
      ('CS 401', 'Advanced Distributed Systems', 5),
      ('MATH 101', 'Calculus I', 5),
      ('MATH 201', 'Linear Algebra', 5),
      ('HIST 101', 'History of Kazakhstan', 5)
    ON CONFLICT (code) DO NOTHING;
  `);
  console.log('Database initialized with sessions & caching tables.');
}

export { pool };
