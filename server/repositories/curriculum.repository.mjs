import { pool } from '../db.mjs';

export class CurriculumRepository {
  async getCatalogCourses() {
    const res = await pool.query(`
      SELECT code, name, ects FROM course_catalog
      UNION
      SELECT course_code AS code, course_code AS name, 5 AS ects FROM prerequisites
      UNION
      SELECT prereq_code AS code, prereq_code AS name, 5 AS ects FROM prerequisites
    `);
    const map = new Map();
    for (const row of res.rows) {
      if (row.code) {
        map.set(row.code.toUpperCase().trim(), row);
      }
    }
    return map;
  }

  async isCourseInCatalog(code) {
    if (!code) return false;
    const cleanCode = code.toUpperCase().trim();
    const res = await pool.query(
      `SELECT 1 FROM course_catalog WHERE UPPER(code) = $1
       UNION
       SELECT 1 FROM prerequisites WHERE UPPER(course_code) = $1 OR UPPER(prereq_code) = $1
       LIMIT 1`,
      [cleanCode]
    );
    return res.rowCount > 0;
  }

  async addCatalogCourse(code, name, ects = 5) {
    const cleanCode = code.toUpperCase().trim();
    await pool.query(
      `INSERT INTO course_catalog (code, name, ects)
       VALUES ($1, $2, $3)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, ects = EXCLUDED.ects`,
      [cleanCode, name || cleanCode, ects]
    );
  }

  async createCurriculum({ program, academic_year, version_title, is_published = false }) {
    const res = await pool.query(
      `INSERT INTO program_curriculums (program, academic_year, version_title, is_published)
       VALUES ($1, $2, $3, $4)
       RETURNING id, program, academic_year, version_title, is_published, created_at`,
      [program, academic_year, version_title, is_published]
    );
    return res.rows[0];
  }

  async addCurriculumCourses(curriculumId, courses) {
    if (!courses || courses.length === 0) return;
    for (const c of courses) {
      await pool.query(
        `INSERT INTO program_curriculum_courses (curriculum_id, semester, course_code, course_name, ects, course_type)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          curriculumId,
          c.semester,
          c.course_code.toUpperCase().trim(),
          c.course_name || c.course_code,
          c.ects || 5,
          c.course_type || 'Mandatory',
        ]
      );
    }
  }

  async listCurriculums() {
    const res = await pool.query(`
      SELECT 
        c.id, 
        c.program, 
        c.academic_year, 
        c.version_title, 
        c.is_published, 
        c.created_at,
        COUNT(cc.id)::int AS course_count,
        COALESCE(MAX(cc.semester), 0)::int AS max_semester
      FROM program_curriculums c
      LEFT JOIN program_curriculum_courses cc ON cc.curriculum_id = c.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    return res.rows;
  }

  async getCurriculumById(id) {
    const res = await pool.query(
      `SELECT id, program, academic_year, version_title, is_published, created_at
       FROM program_curriculums
       WHERE id = $1`,
      [id]
    );
    return res.rows[0] || null;
  }

  async getCurriculumCourses(curriculumId) {
    const res = await pool.query(
      `SELECT id, curriculum_id, semester, course_code, course_name, ects, course_type
       FROM program_curriculum_courses
       WHERE curriculum_id = $1
       ORDER BY semester ASC, course_code ASC`,
      [curriculumId]
    );
    return res.rows;
  }

  async setPublished(id, isPublished) {
    const curr = await this.getCurriculumById(id);
    if (!curr) return null;

    if (isPublished) {
      // Unpublish other versions of the same program and academic_year
      await pool.query(
        `UPDATE program_curriculums 
         SET is_published = false 
         WHERE program = $1 AND academic_year = $2 AND id != $3`,
        [curr.program, curr.academic_year, id]
      );
    }

    const res = await pool.query(
      `UPDATE program_curriculums
       SET is_published = $1
       WHERE id = $2
       RETURNING id, program, academic_year, version_title, is_published, created_at`,
      [isPublished, id]
    );
    return res.rows[0];
  }

  async deleteCurriculum(id) {
    await pool.query('DELETE FROM program_curriculums WHERE id = $1', [id]);
  }

  async findPublishedCurriculum(program, academicYear = null) {
    let query = `
      SELECT id, program, academic_year, version_title, is_published, created_at
      FROM program_curriculums
      WHERE is_published = true AND LOWER(program) = LOWER($1)
    `;
    const params = [program];

    if (academicYear) {
      query += ` AND academic_year = $2`;
      params.push(academicYear);
    }
    query += ` ORDER BY created_at DESC LIMIT 1`;

    const res = await pool.query(query, params);
    return res.rows[0] || null;
  }
}

export const curriculumRepository = new CurriculumRepository();
