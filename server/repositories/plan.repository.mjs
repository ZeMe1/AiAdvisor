import { pool } from '../db.mjs';

export class PlanRepository {
  /**
   * Saves or updates an approved semester study plan for a student.
   */
  async savePlan(username, targetSemester, courses, totalEcts, isApproved = true) {
    const sem = parseInt(targetSemester, 10) || 1;
    const ects = parseInt(totalEcts, 10) || 0;
    const coursesJson = JSON.stringify(courses || []);

    const { rows } = await pool.query(
      `INSERT INTO student_semester_plans (username, target_semester, courses, total_ects, is_approved, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, NOW())
       ON CONFLICT (username, target_semester)
       DO UPDATE SET
         courses = EXCLUDED.courses,
         total_ects = EXCLUDED.total_ects,
         is_approved = EXCLUDED.is_approved,
         updated_at = NOW()
       RETURNING *`,
      [username, sem, coursesJson, ects, isApproved]
    );

    return rows[0];
  }

  /**
   * Retrieves student's approved study plan for a specific semester or the latest one.
   */
  async getPlan(username, targetSemester = null) {
    if (!username) return null;

    if (targetSemester) {
      const sem = parseInt(targetSemester, 10);
      const { rows } = await pool.query(
        `SELECT * FROM student_semester_plans
         WHERE username = $1 AND target_semester = $2`,
        [username, sem]
      );
      return rows[0] || null;
    }

    const { rows } = await pool.query(
      `SELECT * FROM student_semester_plans
       WHERE username = $1
       ORDER BY target_semester DESC
       LIMIT 1`,
      [username]
    );
    return rows[0] || null;
  }

  /**
   * Retrieves all approved plans for a student across all semesters.
   */
  async getAllPlans(username) {
    if (!username) return [];
    const { rows } = await pool.query(
      `SELECT * FROM student_semester_plans
       WHERE username = $1
       ORDER BY target_semester ASC`,
      [username]
    );
    return rows;
  }

  /**
   * Deletes a student's plan for a semester.
   */
  async deletePlan(username, targetSemester) {
    const sem = parseInt(targetSemester, 10);
    const { rows } = await pool.query(
      `DELETE FROM student_semester_plans
       WHERE username = $1 AND target_semester = $2
       RETURNING *`,
      [username, sem]
    );
    return rows[0] || null;
  }
}

export const planRepository = new PlanRepository();
