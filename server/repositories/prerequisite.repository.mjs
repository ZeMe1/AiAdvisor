import { pool } from '../db.mjs';

// Default academic catalog prerequisites (built-in knowledge base & fallbacks)
export const DEFAULT_PREREQUISITES = [
  // Computer Science core links
  { course_code: 'CSS 108', prereq_course_code: 'CSS 105', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'CSS 215', prereq_course_code: 'CSS 108', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'CSS 216', prereq_course_code: 'CSS 108', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'INF 318', prereq_course_code: 'CSS 108', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'INF 376', prereq_course_code: 'CSS 215', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'MAT 138', prereq_course_code: 'MAT 137', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'MDE 292', prereq_course_code: 'MDE 291', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'MDE 293', prereq_course_code: 'MDE 292', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'MDE 294', prereq_course_code: 'MDE 293', min_grade: 'D', type: 'prerequisite' },

  // User Story 11 Acceptance Criteria scenarios
  { course_code: 'CS 201', prereq_course_code: 'CS 101', min_grade: 'C', type: 'prerequisite' },
  { course_code: 'MATH 201', prereq_course_code: 'MATH 101', min_grade: 'D', type: 'prerequisite' },
  { course_code: 'CS 301', prereq_course_code: 'CS 201', min_grade: 'C', type: 'prerequisite' },
];

export class PrerequisiteRepository {
  async getAllPrerequisites() {
    try {
      const res = await pool.query('SELECT course_code, prereq_course_code, min_grade, type FROM prerequisites');
      const dbRules = res.rows;
      const map = new Map();
      for (const r of DEFAULT_PREREQUISITES) {
        map.set(`${r.course_code.toUpperCase()}:${r.prereq_course_code.toUpperCase()}`, r);
      }
      for (const r of dbRules) {
        map.set(`${r.course_code.toUpperCase()}:${r.prereq_course_code.toUpperCase()}`, r);
      }
      return Array.from(map.values());
    } catch {
      return DEFAULT_PREREQUISITES;
    }
  }

  async getPrerequisitesForCourse(courseCode) {
    const all = await this.getAllPrerequisites();
    const target = courseCode.toUpperCase().trim();
    return all.filter((r) => r.course_code.toUpperCase().trim() === target);
  }

  async addPrerequisite(courseCode, prereqCourseCode, minGrade = 'D', type = 'prerequisite') {
    const q = `
      INSERT INTO prerequisites (course_code, prereq_course_code, min_grade, type)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (course_code, prereq_course_code)
      DO UPDATE SET min_grade = EXCLUDED.min_grade, type = EXCLUDED.type
      RETURNING *
    `;
    const res = await pool.query(q, [
      courseCode.toUpperCase().trim(),
      prereqCourseCode.toUpperCase().trim(),
      minGrade.toUpperCase().trim(),
      type.toLowerCase().trim(),
    ]);
    return res.rows[0];
  }
}

export const prerequisiteRepository = new PrerequisiteRepository();
