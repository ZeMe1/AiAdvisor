import { pool } from '../db.mjs';
import { cacheRepository } from './cache.repository.mjs';

export class MessagesRepository {
  /** ----------------- 1-to-1 Direct Messages (US26, US27, US28) ----------------- */
  async addDirectMessage({
    studentUsername,
    advisorUsername,
    groupId = null,
    senderUsername,
    content,
    createdAt = null,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO advisor_messages (student_username, advisor_username, group_id, sender_username, content, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, false, COALESCE($6::timestamptz, NOW()))
       RETURNING id, student_username, advisor_username, group_id, sender_username, content, is_read, read_at, created_at`,
      [
        String(studentUsername).trim(),
        String(advisorUsername).trim(),
        groupId != null ? Number(groupId) : null,
        String(senderUsername).trim(),
        String(content).trim(),
        createdAt || null,
      ]
    );
    return rows[0] || null;
  }

  async getDialogMessages(studentUsername, advisorUsername, limit = 200) {
    if (!studentUsername || !advisorUsername) return [];
    const { rows } = await pool.query(
      `SELECT id, student_username, advisor_username, group_id, sender_username, content, is_read, read_at, created_at
       FROM advisor_messages
       WHERE student_username = $1 AND advisor_username = $2
       ORDER BY created_at ASC, id ASC
       LIMIT $3`,
      [String(studentUsername).trim(), String(advisorUsername).trim(), Number(limit) || 200]
    );
    return rows || [];
  }

  async markDialogRead(studentUsername, advisorUsername, readerUsername) {
    if (!studentUsername || !advisorUsername || !readerUsername) return 0;
    const { rowCount, rows } = await pool.query(
      `UPDATE advisor_messages
       SET is_read = true, read_at = NOW()
       WHERE student_username = $1
         AND advisor_username = $2
         AND sender_username != $3
         AND is_read = false
       RETURNING id`,
      [
        String(studentUsername).trim(),
        String(advisorUsername).trim(),
        String(readerUsername).trim(),
      ]
    );
    return rows?.length ?? rowCount ?? 0;
  }

  async listMessagesForAdvisor(advisorUsername) {
    if (!advisorUsername) return [];
    const { rows } = await pool.query(
      `SELECT id, student_username, advisor_username, group_id, sender_username, content, is_read, read_at, created_at
       FROM advisor_messages
       WHERE advisor_username = $1
       ORDER BY created_at ASC, id ASC`,
      [String(advisorUsername).trim()]
    );
    return rows || [];
  }

  async listUnreadDirectForUser(username, role) {
    if (!username) return [];
    const clean = String(username).trim();
    if (role === 'Advisor') {
      const { rows } = await pool.query(
        `SELECT id, student_username, advisor_username, group_id, sender_username, content, is_read, created_at
         FROM advisor_messages
         WHERE advisor_username = $1 AND sender_username != $1 AND is_read = false
         ORDER BY created_at DESC, id DESC`,
        [clean]
      );
      return rows || [];
    }
    const { rows } = await pool.query(
      `SELECT id, student_username, advisor_username, group_id, sender_username, content, is_read, created_at
       FROM advisor_messages
       WHERE student_username = $1 AND sender_username != $1 AND is_read = false
       ORDER BY created_at DESC, id DESC`,
      [clean]
    );
    return rows || [];
  }

  /** ----------------- Group Announcements & Reads (US29) ----------------- */
  async createAnnouncement({
    groupId,
    advisorUsername,
    content,
    recipientUsernames = [],
    createdAt = null,
  }) {
    const cleanRecipients = Array.from(
      new Set((recipientUsernames || []).map((u) => String(u || '').trim()).filter(Boolean))
    );
    const { rows } = await pool.query(
      `INSERT INTO group_announcements (group_id, advisor_username, content, recipient_usernames, created_at)
       VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamptz, NOW()))
       RETURNING id, group_id, advisor_username, content, recipient_usernames, created_at`,
      [
        Number(groupId),
        String(advisorUsername).trim(),
        String(content).trim(),
        JSON.stringify(cleanRecipients),
        createdAt || null,
      ]
    );
    return rows[0] || null;
  }

  async listGroupAnnouncements(groupId, limit = 100) {
    if (!groupId) return [];
    const { rows } = await pool.query(
      `SELECT id, group_id, advisor_username, content, recipient_usernames, created_at
       FROM group_announcements
       WHERE group_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      [Number(groupId), Number(limit) || 100]
    );
    return rows || [];
  }

  async listReadsForAnnouncements(announcementIds = []) {
    const cleanIds = (announcementIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (cleanIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT announcement_id, student_username, read_at
       FROM group_announcement_reads
       WHERE announcement_id = ANY($1::int[])`,
      [cleanIds]
    );
    return rows || [];
  }

  async markAnnouncementsRead(announcementIds = [], studentUsername) {
    const cleanIds = (announcementIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const cleanUser = String(studentUsername || '').trim();
    if (cleanIds.length === 0 || !cleanUser) return 0;

    let inserted = 0;
    for (const id of cleanIds) {
      const { rowCount, rows } = await pool.query(
        `INSERT INTO group_announcement_reads (announcement_id, student_username, read_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (announcement_id, student_username) DO NOTHING
         RETURNING announcement_id`,
        [id, cleanUser]
      );
      inserted += rows?.length ?? rowCount ?? 0;
    }
    return inserted;
  }

  /** ----------------- Batch Academic Snapshot Inputs (US27) ----------------- */
  async getStudentsAcademicRawData(usernames = []) {
    const cleanUsers = Array.from(
      new Set((usernames || []).map((u) => String(u || '').trim()).filter(Boolean))
    );
    if (cleanUsers.length === 0) {
      return {
        studentCacheByUser: new Map(),
        curriculumByUser: new Map(),
        plansByUser: new Map(),
        lastFeedbackByUser: new Map(),
      };
    }

    const [cacheRes, plansRes, feedbackRes] = await Promise.all([
      pool.query(
        `SELECT username, term, track, approved_courses, cached_at
         FROM student_data_cache
         WHERE username = ANY($1::text[])`,
        [cleanUsers]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT username, target_semester, courses, total_ects, is_approved, updated_at
         FROM student_semester_plans
         WHERE username = ANY($1::text[])`,
        [cleanUsers]
      ).catch(() => ({ rows: [] })),
      pool.query(
        `SELECT username, MAX(created_at) AS last_feedback_at
         FROM recommendation_feedback
         WHERE username = ANY($1::text[])
         GROUP BY username`,
        [cleanUsers]
      ).catch(() => ({ rows: [] })),
    ]);

    const studentCacheByUser = new Map();
    for (const r of cacheRes.rows || []) {
      if (r?.username) studentCacheByUser.set(r.username.toLowerCase(), r);
    }

    const plansByUser = new Map();
    for (const p of plansRes.rows || []) {
      if (!p?.username) continue;
      const key = p.username.toLowerCase();
      const prev = plansByUser.get(key);
      if (!prev || Number(p.target_semester) >= Number(prev.target_semester)) {
        plansByUser.set(key, p);
      }
    }

    const lastFeedbackByUser = new Map();
    for (const f of feedbackRes.rows || []) {
      if (f?.username && f.last_feedback_at) {
        lastFeedbackByUser.set(f.username.toLowerCase(), f.last_feedback_at);
      }
    }

    // Load cached curriculums where available for GPA calculation
    const curriculumByUser = new Map();
    await Promise.all(
      cleanUsers.map(async (u) => {
        const sCache = studentCacheByUser.get(u.toLowerCase());
        const trackId = sCache?.track?.id;
        if (!trackId) return;
        const curr = await cacheRepository.getCurriculum(`${u}:${trackId}`, Infinity).catch(() => null);
        if (curr?.curriculum) {
          curriculumByUser.set(u.toLowerCase(), curr.curriculum);
        }
      })
    );

    return {
      studentCacheByUser,
      curriculumByUser,
      plansByUser,
      lastFeedbackByUser,
    };
  }
}

export const messagesRepository = new MessagesRepository();
