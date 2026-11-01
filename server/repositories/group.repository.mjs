import { pool } from '../db.mjs';

export class GroupRepository {
  async listGroups() {
    const { rows } = await pool.query(`
      SELECT 
        g.id,
        g.name,
        g.program,
        g.study_year,
        g.advisor_username,
        u.display_name AS advisor_display_name,
        u.avatar_url AS advisor_avatar_url,
        u.role AS advisor_role,
        COUNT(m.id)::int AS member_count,
        g.created_at
      FROM student_groups g
      LEFT JOIN users u ON g.advisor_username = u.username
      LEFT JOIN group_members m ON g.id = m.group_id
      GROUP BY g.id, u.username, u.display_name, u.avatar_url, u.role
      ORDER BY g.name ASC;
    `);
    return rows;
  }

  async findGroupById(id) {
    const { rows } = await pool.query(`
      SELECT 
        g.id,
        g.name,
        g.program,
        g.study_year,
        g.advisor_username,
        u.display_name AS advisor_display_name,
        u.avatar_url AS advisor_avatar_url,
        u.role AS advisor_role,
        g.created_at
      FROM student_groups g
      LEFT JOIN users u ON g.advisor_username = u.username
      WHERE g.id = $1
    `, [id]);
    return rows[0] || null;
  }

  async findGroupByName(name) {
    const { rows } = await pool.query(
      'SELECT * FROM student_groups WHERE LOWER(name) = LOWER($1)',
      [name]
    );
    return rows[0] || null;
  }

  async createGroup({ name, program, study_year = 1, advisor_username = null }) {
    const { rows } = await pool.query(`
      INSERT INTO student_groups (name, program, study_year, advisor_username)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, program, study_year, advisor_username || null]);
    return rows[0];
  }

  async upsertGroup({ name, program, study_year = 1 }) {
    const { rows } = await pool.query(`
      INSERT INTO student_groups (name, program, study_year)
      VALUES ($1, $2, $3)
      ON CONFLICT (name) 
      DO UPDATE SET program = EXCLUDED.program, study_year = EXCLUDED.study_year
      RETURNING *
    `, [name, program, study_year]);
    return rows[0];
  }

  async assignAdvisor(groupId, advisor_username) {
    const { rows } = await pool.query(`
      UPDATE student_groups
      SET advisor_username = $1
      WHERE id = $2
      RETURNING *
    `, [advisor_username || null, groupId]);
    return rows[0] || null;
  }

  async enrollStudent(groupId, username) {
    // Unique constraint on group_members(username) ensures at most one group per student
    const { rows } = await pool.query(`
      INSERT INTO group_members (group_id, username, enrolled_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (username) 
      DO UPDATE SET group_id = EXCLUDED.group_id, enrolled_at = NOW()
      RETURNING *
    `, [groupId, username]);
    return rows[0];
  }

  async getStudentGroupAndAdvisor(username) {
    const { rows } = await pool.query(`
      SELECT 
        g.id AS group_id,
        g.name AS group_name,
        g.program,
        g.study_year,
        g.advisor_username,
        u.display_name AS advisor_display_name,
        u.avatar_url AS advisor_avatar_url,
        u.role AS advisor_role
      FROM group_members m
      JOIN student_groups g ON m.group_id = g.id
      LEFT JOIN users u ON g.advisor_username = u.username
      WHERE m.username = $1
    `, [username]);
    return rows[0] || null;
  }

  async listGroupMembers(groupId) {
    const { rows } = await pool.query(`
      SELECT 
        m.id,
        m.username,
        m.enrolled_at,
        u.display_name,
        u.avatar_url,
        u.role
      FROM group_members m
      LEFT JOIN users u ON m.username = u.username
      WHERE m.group_id = $1
      ORDER BY m.username ASC
    `, [groupId]);
    return rows;
  }

  async deleteGroup(id) {
    const { rows } = await pool.query('DELETE FROM student_groups WHERE id = $1 RETURNING *', [id]);
    return rows[0] || null;
  }
}

export const groupRepository = new GroupRepository();
