import { pool } from '../db.mjs';

export class UserRepository {
  async findByUsername(username) {
    if (!username) return null;
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    return rows[0] || null;
  }

  async findById(id) {
    if (!id) return null;
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] || null;
  }

  async findOrCreateUser(username) {
    const existing = await this.findByUsername(username);
    if (existing) return existing;

    const { rows } = await pool.query(
      'INSERT INTO users (username, role) VALUES ($1, $2) RETURNING *',
      [username, 'Student']
    );
    return rows[0];
  }

  async getProfile(username) {
    const { rows } = await pool.query(
      'SELECT username, display_name, avatar_url, role FROM users WHERE username = $1',
      [username]
    );
    return rows[0] || null;
  }

  async updateProfile(username, { display_name, avatar_url }) {
    const { rows } = await pool.query(
      `UPDATE users 
       SET display_name = $1, avatar_url = $2 
       WHERE username = $3 
       RETURNING username, display_name, avatar_url, role`,
      [display_name ?? null, avatar_url ?? null, username]
    );
    return rows[0] || null;
  }
//
  async listAllUsers() {
    const { rows } = await pool.query(
      'SELECT id, username, display_name, role, is_blocked, created_at FROM users ORDER BY created_at DESC'
    );
    return rows;
  }

  async updateRole(username, role) {
    const { rows } = await pool.query(
      'UPDATE users SET role = $1 WHERE username = $2 RETURNING id, username, role',
      [role, username]
    );
    return rows[0] || null;
  }

  async setBlocked(username, is_blocked) {
    const { rows } = await pool.query(
      'UPDATE users SET is_blocked = $1 WHERE username = $2 RETURNING id, username, is_blocked',
      [!!is_blocked, username]
    );
    return rows[0] || null;
  }
}

export const userRepository = new UserRepository();
