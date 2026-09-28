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
  `);
  console.log('Database initialized.');
}

export { pool, bcrypt };
