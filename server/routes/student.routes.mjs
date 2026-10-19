import { Router } from 'express';
import { pool } from '../db.mjs';
import { requireAuth } from '../middlewares/auth.middleware.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';
import { HttpError } from '../errors/http-error.mjs';
import {
  parseTranscript,
  normalizeGrade,
  computeSummary,
  computeAcademicProgress,
} from '../transcript-parser.mjs';

const DEMO = process.env.DEMO === '1';
const router = Router();

router.use(requireAuth);

// ------------------------------------------------- Catalog (Story 8)
router.get('/catalog', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, code, name, credits, description, language, semester FROM courses WHERE is_archived = false ORDER BY code ASC'
  );
  res.json(rows);
}));

// ------------------------------------------------- Transcript (Story 9)
router.get('/student/transcript', asyncHandler(async (req, res) => {
  const username = req.client?.localUsername || (DEMO ? '240103165' : null);
  const { rows } = await pool.query(
    'SELECT * FROM student_transcripts WHERE username = $1',
    [username]
  );
  const summary = computeSummary(rows);
  res.json({
    courses: rows,
    ...summary,
  });
}));

router.get('/student/progress', asyncHandler(async (req, res) => {
  const username = req.client?.localUsername || (DEMO ? '240103165' : null);
  if (!username) throw HttpError.unauthorized('Unauthorized');

  const { rows } = await pool.query(
    'SELECT * FROM student_transcripts WHERE username = $1 ORDER BY id ASC',
    [username]
  );

  const progress = computeAcademicProgress(rows, 240);
  res.json({
    username,
    ...progress,
  });
}));

router.post('/student/transcript/parse', asyncHandler(async (req, res) => {
  const { fileData, fileName } = req.body ?? {};
  if (!fileData) throw HttpError.badRequest('Transcript file is required');

  const base64Data = fileData.replace(/^data:.*?;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0) throw HttpError.badRequest('File is empty');

  const { rows: catalogCourses } = await pool.query(
    'SELECT code, name, credits FROM courses WHERE is_archived = false'
  );

  const authUser = {
    username: req.client?.localUsername || (DEMO ? '240103165' : null),
    role: req.client?.localRole || 'Student',
  };

  const parsed = await parseTranscript(buffer, fileName || 'transcript.pdf', catalogCourses, authUser);
  res.json(parsed);
}));

router.post('/student/transcript/confirm', asyncHandler(async (req, res) => {
  const username = req.client?.localUsername || (DEMO ? '240103165' : null);
  const { courses } = req.body ?? {};
  if (!Array.isArray(courses) || courses.length === 0) {
    throw HttpError.badRequest('Course list cannot be empty');
  }

  const saved = [];
  for (const c of courses) {
    const code = String(c.course_code || '').trim().toUpperCase();
    if (!code) continue;
    const name = String(c.course_name || code).trim();
    const credits = Number(c.credits) || 5;
    const gradeInfo = normalizeGrade(c.grade || 'P');
    const semester = String(c.semester || 'Completed').trim();

    const { rows } = await pool.query(
      `INSERT INTO student_transcripts (username, course_code, course_name, credits, grade, gpa_points, semester)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [username, code, name, credits, gradeInfo.grade, gradeInfo.gpa, semester]
    );
    if (rows[0]) saved.push(rows[0]);
  }

  const summary = computeSummary(saved);
  res.json({
    status: 'ok',
    savedCount: saved.length,
    courses: saved,
    ...summary,
  });
}));

router.post('/student/transcript/manual', asyncHandler(async (req, res) => {
  const username = req.client?.localUsername || (DEMO ? '240103165' : null);
  const { course_code, course_name, credits, grade, semester } = req.body ?? {};
  if (!course_code) throw HttpError.badRequest('Course code is required');

  const code = String(course_code).trim().toUpperCase();
  const name = String(course_name || code).trim();
  const cCredits = Number(credits) || 5;
  const gradeInfo = normalizeGrade(grade || 'A');
  const sem = String(semester || 'Completed').trim();

  const { rows } = await pool.query(
    `INSERT INTO student_transcripts (username, course_code, course_name, credits, grade, gpa_points, semester)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [username, code, name, cCredits, gradeInfo.grade, gradeInfo.gpa, sem]
  );

  res.json(rows[0]);
}));

router.delete('/student/transcript/:id', asyncHandler(async (req, res) => {
  const username = req.client?.localUsername || (DEMO ? '240103165' : null);
  const id = Number(req.params.id);
  if (!id) throw HttpError.badRequest('Invalid id');

  const { rows } = await pool.query(
    'DELETE FROM student_transcripts WHERE id = $1 AND username = $2 RETURNING *',
    [id, username]
  );
  if (rows.length === 0) throw HttpError.notFound('Course not found');
  res.json({ status: 'ok', deleted: rows[0] });
}));

router.delete('/student/transcript', asyncHandler(async (req, res) => {
  const username = req.client?.localUsername || (DEMO ? '240103165' : null);
  await pool.query('DELETE FROM student_transcripts WHERE username = $1', [username]);
  res.json({ status: 'ok', message: 'Transcript cleared successfully' });
}));

export default router;
