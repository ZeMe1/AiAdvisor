import { pool } from '../db.mjs';

export const STUDENT_CACHE_TTL_MS = 20 * 60 * 1000;       // 20 минут для регистраций / корзины
export const CURRICULUM_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа для куррикулума
export const SECTIONS_CACHE_TTL_MS = 15 * 60 * 1000;       // 15 минут для секций

export class CacheRepository {
  /** ----------------- Student Data Cache (/api/me) ----------------- */
  async getStudentData(username, maxAgeMs = STUDENT_CACHE_TTL_MS) {
    if (!username) return null;
    const { rows } = await pool.query(
      `SELECT term, is_approved, track, prog_track, approved_courses, basket_schedule, cached_at
       FROM student_data_cache
       WHERE username = $1`,
      [username]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const age = Date.now() - new Date(row.cached_at).getTime();
    if (age > maxAgeMs) return null;

    return {
      authenticated: true,
      term: row.term,
      isApproved: row.is_approved,
      track: row.track,
      progTrack: row.prog_track,
      approved: row.approved_courses,
      schedule: row.basket_schedule,
      cachedAt: row.cached_at,
    };
  }

  async setStudentData(username, data) {
    if (!username || !data) return;
    await pool.query(
      `INSERT INTO student_data_cache (username, term, is_approved, track, prog_track, approved_courses, basket_schedule, cached_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7::jsonb, NOW())
       ON CONFLICT (username) DO UPDATE SET
         term = EXCLUDED.term,
         is_approved = EXCLUDED.is_approved,
         track = EXCLUDED.track,
         prog_track = EXCLUDED.prog_track,
         approved_courses = EXCLUDED.approved_courses,
         basket_schedule = EXCLUDED.basket_schedule,
         cached_at = NOW()`,
      [
        username,
        data.term ?? null,
        !!data.isApproved,
        JSON.stringify(data.track ?? {}),
        data.progTrack ?? null,
        JSON.stringify(data.approved ?? []),
        JSON.stringify(data.schedule ?? []),
      ]
    );
  }

  async clearStudentData(username) {
    if (!username) return;
    await pool.query('DELETE FROM student_data_cache WHERE username = $1', [username]);
  }

  /** ----------------- Curriculum Cache (/api/curriculum) ----------------- */
  async getCurriculum(trackId, maxAgeMs = CURRICULUM_CACHE_TTL_MS) {
    if (!trackId) return null;
    const { rows } = await pool.query(
      `SELECT curriculum, sections_defaults, cached_at
       FROM curriculum_cache
       WHERE track_id = $1`,
      [String(trackId)]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const age = Date.now() - new Date(row.cached_at).getTime();
    if (age > maxAgeMs) return null;

    return {
      curriculum: row.curriculum,
      sectionsDefaults: row.sections_defaults,
    };
  }

  async setCurriculum(trackId, curriculum, sectionsDefaults) {
    if (!trackId || !curriculum) return;
    await pool.query(
      `INSERT INTO curriculum_cache (track_id, curriculum, sections_defaults, cached_at)
       VALUES ($1, $2::jsonb, $3::jsonb, NOW())
       ON CONFLICT (track_id) DO UPDATE SET
         curriculum = EXCLUDED.curriculum,
         sections_defaults = EXCLUDED.sections_defaults,
         cached_at = NOW()`,
      [
        String(trackId),
        JSON.stringify(curriculum),
        JSON.stringify(sectionsDefaults ?? null),
      ]
    );
  }

  /** ----------------- Course Sections Cache (/api/sections) ----------------- */
  async getSections(cacheKey, maxAgeMs = SECTIONS_CACHE_TTL_MS) {
    if (!cacheKey) return null;
    const { rows } = await pool.query(
      `SELECT data, cached_at
       FROM course_sections_cache
       WHERE cache_key = $1`,
      [cacheKey]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    const age = Date.now() - new Date(row.cached_at).getTime();
    if (age > maxAgeMs) return null;

    return row.data;
  }

  async setSections(cacheKey, data) {
    if (!cacheKey || !data) return;
    await pool.query(
      `INSERT INTO course_sections_cache (cache_key, data, cached_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (cache_key) DO UPDATE SET
         data = EXCLUDED.data,
         cached_at = NOW()`,
      [cacheKey, JSON.stringify(data)]
    );
  }

  /** ----------------- Очистка устаревшего кэша ----------------- */
  async cleanupExpiredCache() {
    await pool.query(`
      DELETE FROM student_data_cache WHERE cached_at < NOW() - INTERVAL '2 hours';
      DELETE FROM course_sections_cache WHERE cached_at < NOW() - INTERVAL '1 day';
      DELETE FROM curriculum_cache WHERE cached_at < NOW() - INTERVAL '7 days';
    `);
  }
}

export const cacheRepository = new CacheRepository();

// Именованный экспорт для обратной совместимости
export const getCachedStudentData = (u, m) => cacheRepository.getStudentData(u, m);
export const setCachedStudentData = (u, d) => cacheRepository.setStudentData(u, d);
export const clearCachedStudentData = (u) => cacheRepository.clearStudentData(u);
export const getCachedCurriculum = (t, m) => cacheRepository.getCurriculum(t, m);
export const setCachedCurriculum = (t, c, d) => cacheRepository.setCurriculum(t, c, d);
export const getCachedSections = (k, m) => cacheRepository.getSections(k, m);
export const setCachedSections = (k, d) => cacheRepository.setSections(k, d);
