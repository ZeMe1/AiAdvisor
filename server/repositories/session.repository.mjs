import crypto from 'node:crypto';
import { pool } from '../db.mjs';

export class SessionRepository {
  async createSession({ userId, username, role, status = 'authed', sduJar = {} }) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const jarJson = JSON.stringify(sduJar);

    await pool.query(
      `INSERT INTO sessions (id, user_id, username, role, status, sdu_jar, created_at, updated_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW(), NOW(), NOW() + INTERVAL '7 days')`,
      [sessionId, userId, username, role, status, jarJson]
    );

    return sessionId;
  }

  async getSession(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') return null;

    const { rows } = await pool.query(
      `SELECT s.id, s.user_id, s.username, u.role, s.status, s.sdu_jar, s.expires_at, u.is_blocked
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW()`,
      [sessionId]
    );

    if (rows.length === 0) return null;
    const session = rows[0];
    if (session.is_blocked) return null;
    return session;
  }

  async updateSession(sessionId, { status, sduJar }) {
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

  async deleteSession(sessionId) {
    if (!sessionId) return;
    await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  }

  async deleteUserSessions(username) {
    if (!username) return;
    await pool.query('DELETE FROM sessions WHERE username = $1', [username]);
  }
}

export const sessionRepository = new SessionRepository();

// Именованный экспорт для обратной совместимости
export const createSession = (args) => sessionRepository.createSession(args);
export const getSession = (id) => sessionRepository.getSession(id);
export const updateSession = (id, data) => sessionRepository.updateSession(id, data);
export const deleteSession = (id) => sessionRepository.deleteSession(id);
export const deleteUserSessions = (username) => sessionRepository.deleteUserSessions(username);
