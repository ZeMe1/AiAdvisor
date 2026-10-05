import crypto from 'node:crypto';
import { pool } from './db.mjs';

/**
 * Enterprise-grade session service with PostgreSQL backing.
 * Solves:
 * - Cookie race conditions (browser only stores an immutable session ID).
 * - Multi-instance / serverless consistency (Neon DB is the single source of truth).
 * - Multi-user isolation (sessions are strictly bound to users).
 * - Deterministic logout (deletes session from DB).
 */

export async function createSession({ userId, username, role, status = 'authed', sduJar = {} }) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const jarJson = JSON.stringify(sduJar);
  
  await pool.query(
    `INSERT INTO sessions (id, user_id, username, role, status, sdu_jar, created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW(), NOW() + INTERVAL '7 days')`,
    [sessionId, userId, username, role, status, jarJson]
  );

  return sessionId;
}

export async function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;

  const { rows } = await pool.query(
    `SELECT id, user_id, username, role, status, sdu_jar, expires_at
     FROM sessions
     WHERE id = $1 AND expires_at > NOW()`,
    [sessionId]
  );

  if (rows.length === 0) return null;
  return rows[0];
}

export async function updateSession(sessionId, { status, sduJar }) {
  if (!sessionId) return;
  const updates = [];
  const params = [sessionId];
  let idx = 2;

  if (status !== undefined) {
    updates.push(`status = $${idx++}`);
    params.push(status);
  }
  if (sduJar !== undefined) {
    updates.push(`sdu_jar = $${idx++}::jsonb`);
    params.push(JSON.stringify(sduJar));
  }

  updates.push(`updated_at = NOW()`);

  if (updates.length > 0) {
    await pool.query(
      `UPDATE sessions SET ${updates.join(', ')} WHERE id = $1`,
      params
    );
  }
}

export async function deleteSession(sessionId) {
  if (!sessionId) return;
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function deleteUserSessions(username) {
  if (!username) return;
  await pool.query('DELETE FROM sessions WHERE username = $1', [username]);
}
