import { pool } from '../db.mjs';

export class RecommendationRepository {
  async saveFeedback(username, courseCode, isInterested, targetSemester = null) {
    const code = courseCode.toUpperCase().trim();
    const { rows } = await pool.query(
      `INSERT INTO recommendation_feedback (username, course_code, is_interested, target_semester, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (username, course_code)
       DO UPDATE SET
         is_interested = EXCLUDED.is_interested,
         target_semester = COALESCE(EXCLUDED.target_semester, recommendation_feedback.target_semester),
         created_at = NOW()
       RETURNING *`,
      [username, code, !!isInterested, targetSemester]
    );
    return rows[0];
  }

  async getUserFeedback(username) {
    if (!username) return {};
    const { rows } = await pool.query(
      `SELECT course_code, is_interested, target_semester
       FROM recommendation_feedback
       WHERE username = $1`,
      [username]
    );
    const map = {};
    for (const r of rows) {
      map[r.course_code.toUpperCase().trim()] = r.is_interested;
    }
    return map;
  }

  async deleteFeedback(username, courseCode) {
    const code = courseCode.toUpperCase().trim();
    const { rows } = await pool.query(
      `DELETE FROM recommendation_feedback
       WHERE username = $1 AND course_code = $2
       RETURNING *`,
      [username, code]
    );
    return rows[0] || null;
  }
}

export const recommendationRepository = new RecommendationRepository();
