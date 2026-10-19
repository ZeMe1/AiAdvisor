import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.mjs';
import { requireAdmin } from '../middlewares/auth.middleware.mjs';
import { validateBody } from '../middlewares/validate.mjs';
import { updateRoleSchema, blockUserSchema } from '../schemas/user.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';
import { pool } from '../db.mjs';
import { HttpError } from '../errors/http-error.mjs';

const router = Router();

router.use(requireAdmin);

// ------------------------------------------------- Users (Admin)
router.get('/users', asyncHandler((req, res) => adminController.listUsers(req, res)));
router.put('/users/:username/role', validateBody(updateRoleSchema), asyncHandler((req, res) => adminController.updateRole(req, res)));
router.put('/users/:username/block', validateBody(blockUserSchema), asyncHandler((req, res) => adminController.blockUser(req, res)));

// ------------------------------------------------- Courses (Catalog Admin CRUD - Story 6)
router.get('/courses', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM courses ORDER BY is_archived ASC, code ASC'
  );
  res.json(rows);
}));

router.post('/courses', asyncHandler(async (req, res) => {
  const { code, name, credits, description, language, semester, theory_teacher, practice_teacher, teacher, quota } = req.body ?? {};
  if (!code || !name) throw HttpError.badRequest('Course code and title are required');
  if (credits != null && (isNaN(Number(credits)) || Number(credits) < 1)) {
    throw HttpError.badRequest('Credits must be a positive number');
  }
  const tTeacher = String(theory_teacher ?? teacher ?? '').trim();
  const pTeacher = String(practice_teacher ?? theory_teacher ?? teacher ?? '').trim();

  try {
    const { rows } = await pool.query(
      `INSERT INTO courses (code, name, credits, description, language, semester, teacher, theory_teacher, practice_teacher, quota)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        String(code).trim().toUpperCase(),
        String(name).trim(),
        Number(credits) || 5,
        String(description ?? '').trim(),
        String(language ?? 'English').trim(),
        String(semester ?? '').trim(),
        tTeacher,
        tTeacher,
        pTeacher,
        Number(quota) || 30,
      ]
    );
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      throw HttpError.conflict('Course code must be unique');
    }
    throw e;
  }
}));

router.put('/courses/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw HttpError.badRequest('Invalid course id');
  const { code, name, credits, description, language, semester, theory_teacher, practice_teacher, teacher, quota } = req.body ?? {};
  if (!code || !name) throw HttpError.badRequest('Course code and title are required');
  if (credits != null && (isNaN(Number(credits)) || Number(credits) < 1)) {
    throw HttpError.badRequest('Credits must be a positive number');
  }
  const tTeacher = String(theory_teacher ?? teacher ?? '').trim();
  const pTeacher = String(practice_teacher ?? theory_teacher ?? teacher ?? '').trim();

  try {
    const { rows } = await pool.query(
      `UPDATE courses SET code = $1, name = $2, credits = $3, description = $4,
       language = $5, semester = $6, teacher = $7, theory_teacher = $8, practice_teacher = $9,
       quota = $10, updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 RETURNING *`,
      [
        String(code).trim().toUpperCase(),
        String(name).trim(),
        Number(credits) || 5,
        String(description ?? '').trim(),
        String(language ?? 'English').trim(),
        String(semester ?? '').trim(),
        tTeacher,
        tTeacher,
        pTeacher,
        Number(quota) || 30,
        id,
      ]
    );
    if (rows.length === 0) throw HttpError.notFound('Course not found');
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      throw HttpError.conflict('Course code must be unique');
    }
    throw e;
  }
}));

router.delete('/courses/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw HttpError.badRequest('Invalid course id');
  const { rows } = await pool.query('DELETE FROM courses WHERE id = $1 RETURNING *', [id]);
  if (rows.length === 0) throw HttpError.notFound('Course not found');
  res.json({ status: 'ok', deleted: rows[0] });
}));

router.put('/courses/:id/archive', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw HttpError.badRequest('Invalid course id');
  const { is_archived } = req.body ?? {};
  const { rows } = await pool.query(
    `UPDATE courses SET is_archived = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 RETURNING *`,
    [!!is_archived, id]
  );
  if (rows.length === 0) throw HttpError.notFound('Course not found');
  res.json(rows[0]);
}));

// ------------------------------------------------- Prerequisites & Cycle Check (Story 7)
function detectCycle(allLinks, newCourse, newPrereq) {
  const c = String(newCourse).trim().toUpperCase();
  const p = String(newPrereq).trim().toUpperCase();
  if (c === p) {
    return [c, p];
  }

  const graph = new Map();
  for (const link of allLinks) {
    const from = (link.course_code || '').toUpperCase();
    const to = (link.prereq_code || '').toUpperCase();
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  }

  const queue = [[p]];
  const visited = new Set([p]);

  while (queue.length > 0) {
    const path = queue.shift();
    const curr = path[path.length - 1];

    if (curr === c) {
      return [c, ...path];
    }

    const nexts = graph.get(curr) || [];
    for (const n of nexts) {
      if (!visited.has(n)) {
        visited.add(n);
        queue.push([...path, n]);
      }
    }
  }

  return null;
}

router.get('/prerequisites', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM prerequisites');
  res.json(rows);
}));

router.post('/prerequisites', asyncHandler(async (req, res) => {
  const { course_code, prereq_code, min_grade = 'C', type = 'prerequisite' } = req.body ?? {};
  if (!course_code || !prereq_code) {
    throw HttpError.badRequest('Course code and prerequisite code are required');
  }

  const cCode = String(course_code).trim().toUpperCase();
  const pCode = String(prereq_code).trim().toUpperCase();

  if (cCode === pCode) {
    throw HttpError.badRequest('Course cannot be a prerequisite for itself');
  }

  const { rows: allLinks } = await pool.query('SELECT * FROM prerequisites');
  const cycle = detectCycle(allLinks, cCode, pCode);
  if (cycle) {
    throw HttpError.badRequest(`Circular dependency detected: ${cycle.join(' -> ')}`);
  }

  try {
    const { rows } = await pool.query(
      'INSERT INTO prerequisites (course_code, prereq_code, min_grade, type) VALUES ($1, $2, $3, $4) RETURNING *',
      [cCode, pCode, String(min_grade).trim(), String(type).trim()]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      throw HttpError.conflict('This relationship already exists');
    }
    throw err;
  }
}));

router.delete('/prerequisites/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (!id) throw HttpError.badRequest('Invalid id');
  const { rows } = await pool.query('DELETE FROM prerequisites WHERE id = $1 RETURNING *', [id]);
  if (rows.length === 0) throw HttpError.notFound('Relationship not found');
  res.json({ status: 'ok', deleted: rows[0] });
}));

export default router;
