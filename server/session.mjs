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

export async function createSession({ userId, username, role, status = 'authed', sduActive = true, sduJar = {} }) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const jarJson = JSON.stringify(sduJar);
  
  await pool.query(
    `INSERT INTO sessions (id, user_id, username, role, status, sdu_active, sdu_jar, created_at, updated_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW(), NOW() + INTERVAL '7 days')`,
    [sessionId, userId, username, role, status, sduActive, jarJson]
  );

  return sessionId;
}

export async function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;

  const { rows } = await pool.query(
    `SELECT id, user_id, username, role, status, sdu_active, sdu_jar, expires_at
     FROM sessions
     WHERE id = $1 AND expires_at > NOW()`,
    [sessionId]
  );

  if (rows.length === 0) return null;
  return rows[0];
}

export async function refreshSession(sessionId, gracePeriodDays = 14) {
  if (!sessionId || typeof sessionId !== 'string') return null;

  // Продлеваем сессию на 7 дней, если она активна или истекла недавно (в пределах grace period)
  const { rows } = await pool.query(
    `UPDATE sessions
     SET expires_at = NOW() + INTERVAL '7 days',
         updated_at = NOW()
     WHERE id = $1 AND expires_at > (NOW() - ($2 || ' days')::interval)
     RETURNING id, user_id, username, role, status, sdu_active, expires_at`,
    [sessionId, String(gracePeriodDays)]
  );

  return rows[0] || null;
}

export async function updateSession(sessionId, { status, sduActive, sduJar }) {
  if (!sessionId) return;
  const updates = [];
  const params = [sessionId];
  let idx = 2;

  if (status !== undefined) {
    updates.push(`status = $${idx++}`);
    params.push(status);
  }
  if (sduActive !== undefined) {
    updates.push(`sdu_active = $${idx++}`);
    params.push(Boolean(sduActive));
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

export async function setSduActive(sessionId, active) {
  return updateSession(sessionId, { sduActive: active });
}

export async function deleteSession(sessionId) {
  if (!sessionId) return;
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

export async function deleteUserSessions(username) {
  if (!username) return;
  await pool.query('DELETE FROM sessions WHERE username = $1', [username]);
}
