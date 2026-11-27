import { pool } from '../db.mjs';
import { userRepository } from './user.repository.mjs';

export class PresenceRepository {
  async touchPresence(username, isOnline = true, customLastSeenAt = null) {
    if (!username) return null;
    const clean = String(username).trim();
    const { rows } = await pool.query(
      `INSERT INTO user_presence (username, last_seen_at, is_online, updated_at)
       VALUES ($1, COALESCE($3::timestamptz, NOW()), $2, NOW())
       ON CONFLICT (username)
       DO UPDATE SET
         last_seen_at = COALESCE($3::timestamptz, NOW()),
         is_online = $2,
         updated_at = NOW()
       RETURNING username, last_seen_at, is_online, office_hours, response_time_note, updated_at`,
      [clean, Boolean(isOnline), customLastSeenAt || null]
    );
    return rows[0] || null;
  }

  async setOffline(username, customLastSeenAt = null) {
    if (!username) return null;
    const clean = String(username).trim();
    const { rows } = await pool.query(
      `INSERT INTO user_presence (username, last_seen_at, is_online, updated_at)
       VALUES ($1, COALESCE($2::timestamptz, NOW()), false, NOW())
       ON CONFLICT (username)
       DO UPDATE SET
         last_seen_at = COALESCE($2::timestamptz, user_presence.last_seen_at),
         is_online = false,
         updated_at = NOW()
       RETURNING username, last_seen_at, is_online, office_hours, response_time_note, updated_at`,
      [clean, customLastSeenAt || null]
    );
    return rows[0] || null;
  }

  async updateOfficeHours(username, { office_hours = '', response_time_note = '' } = {}) {
    if (!username) return null;
    const clean = String(username).trim();
    const { rows } = await pool.query(
      `INSERT INTO user_presence (username, last_seen_at, is_online, office_hours, response_time_note, updated_at)
       VALUES ($1, NOW(), true, $2, $3, NOW())
       ON CONFLICT (username)
       DO UPDATE SET
         office_hours = $2,
         response_time_note = $3,
         updated_at = NOW()
       RETURNING username, last_seen_at, is_online, office_hours, response_time_note, updated_at`,
      [clean, String(office_hours || '').trim(), String(response_time_note || '').trim()]
    );
    return rows[0] || null;
  }

  async getPresence(username) {
    if (!username) return null;
    const clean = String(username).trim();
    const { rows } = await pool.query(
      `SELECT username, last_seen_at, is_online, office_hours, response_time_note, updated_at
       FROM user_presence
       WHERE username = $1`,
      [clean]
    );
    return rows[0] || null;
  }

  async getPresenceWithUser(username) {
    if (!username) return { user: null, presence: null };
    const clean = String(username).trim();
    const [user, presence] = await Promise.all([
      userRepository.findByUsername(clean),
      this.getPresence(clean),
    ]);
    return { user, presence };
  }
}

export const presenceRepository = new PresenceRepository();
