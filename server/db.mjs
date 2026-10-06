import pg from 'pg';
import bcrypt from 'bcrypt';

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
      password_hash VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      avatar_url TEXT,
      role VARCHAR(50) DEFAULT 'Student',
      is_blocked BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id VARCHAR(64) PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      username VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL,
      sdu_active BOOLEAN DEFAULT true,
      sdu_jar JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '7 days')
    );
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS sdu_active BOOLEAN DEFAULT true;
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

    CREATE TABLE IF NOT EXISTS schedule_variants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL,
      schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_variants_user ON schedule_variants(user_id);
  `);
  console.log('Database initialized with sessions & caching tables.');
}

export { pool, bcrypt };
