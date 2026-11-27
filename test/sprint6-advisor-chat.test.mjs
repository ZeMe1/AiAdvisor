import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.mjs';
import { initDb, pool } from '../server/db.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';
import { messagesRepository } from '../server/repositories/messages.repository.mjs';
import { cacheRepository } from '../server/repositories/cache.repository.mjs';

describe('Sprint 6 — US26 & US27: Direct Advisor Chat, ACL & Advisor Inbox Snapshots', () => {
  const s1 = 's6qat_chat_s1';
  const s2 = 's6qat_chat_s2';
  const sOther = 's6qat_chat_sother';
  const advA = 's6qat_chat_adva';
  const advB = 's6qat_chat_advb';

  const groupNames = ['S6QAT-CHAT-CS1', 'S6QAT-CHAT-CS2', 'S6QAT-CHAT-OTHER'];
  const allUsers = [s1, s2, sOther, advA, advB];

  const sidS1 = crypto.randomBytes(24).toString('hex');
  const sidS2 = crypto.randomBytes(24).toString('hex');
  const sidSOther = crypto.randomBytes(24).toString('hex');
  const sidAdvA = crypto.randomBytes(24).toString('hex');
  const sidAdvB = crypto.randomBytes(24).toString('hex');

  const cookieS1 = `zeme_session=${sidS1}`;
  const cookieSOther = `zeme_session=${sidSOther}`;
  const cookieAdvA = `zeme_session=${sidAdvA}`;

  let g1;
  let g2;
  let gOther;

  const cleanup = async () => {
    await pool.query('DELETE FROM sessions WHERE id = ANY($1::text[])', [
      [sidS1, sidS2, sidSOther, sidAdvA, sidAdvB],
    ]);
    await pool.query('DELETE FROM advisor_messages WHERE student_username = ANY($1::text[]) OR advisor_username = ANY($1::text[])', [
      allUsers,
    ]);
    await pool.query('DELETE FROM student_semester_plans WHERE username = ANY($1::text[])', [allUsers]);
    await pool.query('DELETE FROM curriculum_cache WHERE track_id = $1', [`${s1}:TRK_S6_1`]);
    await pool.query('DELETE FROM student_data_cache WHERE username = ANY($1::text[])', [allUsers]);
    await pool.query('DELETE FROM group_members WHERE username = ANY($1::text[])', [allUsers]);
    for (const name of groupNames) {
      const existing = await groupRepository.findGroupByName(name);
      if (existing) await groupRepository.deleteGroup(existing.id);
    }
    await pool.query('DELETE FROM user_presence WHERE username = ANY($1::text[])', [allUsers]);
    await pool.query('DELETE FROM users WHERE username = ANY($1::text[])', [allUsers]);
  };

  beforeAll(async () => {
    await initDb();
    await cleanup();

    const insertUser = async (username, displayName, role) => {
      const { rows } = await pool.query(
        `INSERT INTO users (username, display_name, role, is_blocked)
         VALUES ($1, $2, $3, false)
         ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name, role = EXCLUDED.role, is_blocked = false
         RETURNING id`,
        [username, displayName, role]
      );
      return rows[0].id;
    };

    const idS1 = await insertUser(s1, 'Alice CS', 'Student');
    const idS2 = await insertUser(s2, 'Bob IS', 'Student');
    const idSOther = await insertUser(sOther, 'Charlie Other', 'Student');
    const idAdvA = await insertUser(advA, 'Dr. Advisor A', 'Advisor');
    const idAdvB = await insertUser(advB, 'Dr. Advisor B', 'Advisor');

    const insertSession = async (sid, uid, uname, role) => {
      await pool.query(
        `INSERT INTO sessions (id, user_id, username, role, status, sdu_jar)
         VALUES ($1, $2, $3, $4, 'authed', '{}'::jsonb)`,
        [sid, uid, uname, role]
      );
    };

    await Promise.all([
      insertSession(sidS1, idS1, s1, 'Student'),
      insertSession(sidS2, idS2, s2, 'Student'),
      insertSession(sidSOther, idSOther, sOther, 'Student'),
      insertSession(sidAdvA, idAdvA, advA, 'Advisor'),
      insertSession(sidAdvB, idAdvB, advB, 'Advisor'),
    ]);

    g1 = await groupRepository.createGroup({
      name: groupNames[0],
      program: 'Computer Science',
      study_year: 2,
      advisor_username: advA,
    });
    g2 = await groupRepository.createGroup({
      name: groupNames[1],
      program: 'Information Systems',
      study_year: 3,
      advisor_username: advA,
    });
    gOther = await groupRepository.createGroup({
      name: groupNames[2],
      program: 'Mathematics',
      study_year: 1,
      advisor_username: advB,
    });

    await groupRepository.enrollStudent(g1.id, s1);
    await groupRepository.enrollStudent(g2.id, s2);
    await groupRepository.enrollStudent(gOther.id, sOther);

    // Seed academic data for s1 (A=4.0, B=3.0 => GPA 3.50, 20 ECTS semester load)
    await cacheRepository.setStudentData(s1, {
      term: '2026 - 2027 Fall',
      isApproved: true,
      track: { id: 'TRK_S6_1' },
      progTrack: 'CS',
      approved: [{ code: 'CS 301', ects: 5 }],
      basketSchedule: [],
    });
    await cacheRepository.setCurriculum(`${s1}:TRK_S6_1`, {
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'CS 101', name: 'Intro CS', ects: 5, status: 'passed', grade: 'A' },
            { code: 'MATH 101', name: 'Calculus I', ects: 5, status: 'passed', grade: 'B' },
          ],
        },
      ],
    });
    await pool.query(
      `INSERT INTO student_semester_plans (username, target_semester, courses, total_ects, is_approved, updated_at)
       VALUES ($1, 3, $2::jsonb, 20, true, NOW())`,
      [s1, JSON.stringify([{ code: 'CS 201', ects: 5 }])]
    );
  });

  afterAll(async () => {
    await cleanup();
  });

  it('US26 Scenario 1: Enrolled student messages assigned group advisor and receives reply', async () => {
    const sendRes = await request(app)
      .post('/api/messages/student/dialog')
      .set('Cookie', cookieS1)
      .send({ content: 'Hello Dr. Advisor A! 👋 Can you review my Spring courses?' });

    expect(sendRes.status).toBe(201);
    expect(sendRes.body.message.advisorUsername).toBe(advA);
    expect(sendRes.body.message.isMine).toBe(true);
    expect(sendRes.body.message.isRead).toBe(false);

    // Advisor sees unread = 1
    const inboxBefore = await request(app)
      .get('/api/messages/advisor/inbox')
      .set('Cookie', cookieAdvA);
    expect(inboxBefore.status).toBe(200);
    const s1Row = inboxBefore.body.students.find((x) => x.username === s1);
    expect(s1Row.unreadCount).toBe(1);

    // Advisor replies
    const replyRes = await request(app)
      .post(`/api/messages/advisor/threads/${s1}`)
      .set('Cookie', cookieAdvA)
      .send({ content: 'Sure Alice, your 20 ECTS load looks balanced!' });
    expect(replyRes.status).toBe(201);
    expect(replyRes.body.message.senderUsername).toBe(advA);

    // Student opens dialog and sees both messages in chronological order
    const dialogRes = await request(app)
      .get('/api/messages/student/dialog')
      .set('Cookie', cookieS1);
    expect(dialogRes.status).toBe(200);
    expect(dialogRes.body.assigned).toBe(true);
    expect(dialogRes.body.messages).toHaveLength(2);
    expect(dialogRes.body.messages[1].isRead).toBe(true);
  });

  it('US26 Scenario 2: Student from another group receives 403 "You can only message your own group advisor"', async () => {
    const getForb = await request(app)
      .get(`/api/messages/student/dialog?advisor=${advA}`)
      .set('Cookie', cookieSOther);
    expect(getForb.status).toBe(403);
    expect(getForb.body.error).toBe('You can only message your own group advisor');

    const postForb = await request(app)
      .post('/api/messages/student/dialog')
      .set('Cookie', cookieSOther)
      .send({ advisorUsername: advA, content: 'Trying to message another group advisor' });
    expect(postForb.status).toBe(403);
    expect(postForb.body.error).toBe('You can only message your own group advisor');
  });

  it('US27 Scenarios 1 & 2: Advisor inbox sorts by newest unread, includes read-only snapshots, and resets unread to 0 on open', async () => {
    // Clear s1 thread first, then seed 1 older unread from s1 and 3 newer unreads from s2
    await messagesRepository.markDialogRead(s1, advA, advA);
    const now = Date.now();
    await messagesRepository.addDirectMessage({
      studentUsername: s1,
      advisorUsername: advA,
      groupId: g1.id,
      senderUsername: s1,
      content: 'Follow-up from Alice',
      createdAt: new Date(now - 50_000).toISOString(),
    });
    await messagesRepository.addDirectMessage({
      studentUsername: s2,
      advisorUsername: advA,
      groupId: g2.id,
      senderUsername: s2,
      content: 'Unread 1 from Bob',
      createdAt: new Date(now - 30_000).toISOString(),
    });
    await messagesRepository.addDirectMessage({
      studentUsername: s2,
      advisorUsername: advA,
      groupId: g2.id,
      senderUsername: s2,
      content: 'Unread 2 from Bob',
      createdAt: new Date(now - 20_000).toISOString(),
    });
    await messagesRepository.addDirectMessage({
      studentUsername: s2,
      advisorUsername: advA,
      groupId: g2.id,
      senderUsername: s2,
      content: 'Unread 3 newest from Bob',
      createdAt: new Date(now - 5_000).toISOString(),
    });

    const inboxRes = await request(app)
      .get('/api/messages/advisor/inbox')
      .set('Cookie', cookieAdvA);
    expect(inboxRes.status).toBe(200);
    expect(inboxRes.body.groups).toHaveLength(2);
    expect(inboxRes.body.students).toHaveLength(2);
    expect(inboxRes.body.students.some((x) => x.username === sOther)).toBe(false);

    // Sorted by newest unread: s2 (3 unreads) first, s1 (1 unread) second
    expect(inboxRes.body.students[0].username).toBe(s2);
    expect(inboxRes.body.students[0].unreadCount).toBe(3);
    expect(inboxRes.body.students[1].username).toBe(s1);
    expect(inboxRes.body.students[1].unreadCount).toBe(1);

    // Verify Read-Only Academic Snapshot for s1
    const snap = inboxRes.body.students[1].academicSnapshot;
    expect(snap.readOnly).toBe(true);
    expect(snap.gpaFormatted).toBe('3.50');
    expect(snap.semesterLoadEcts).toBe(20);
    expect(snap.lastRecommendationAt).toBeTruthy();

    // Opening s2 thread immediately resets unreadCount to 0
    const openThreadRes = await request(app)
      .get(`/api/messages/advisor/threads/${s2}`)
      .set('Cookie', cookieAdvA);
    expect(openThreadRes.status).toBe(200);
    expect(openThreadRes.body.unreadCount).toBe(0);
    expect(openThreadRes.body.messages.every((m) => m.isRead)).toBe(true);

    const inboxAfter = await request(app)
      .get('/api/messages/advisor/inbox')
      .set('Cookie', cookieAdvA);
    expect(inboxAfter.body.students.find((x) => x.username === s2).unreadCount).toBe(0);

    // Advisor A cannot open thread of Advisor B's student
    const crossGroupRes = await request(app)
      .get(`/api/messages/advisor/threads/${sOther}`)
      .set('Cookie', cookieAdvA);
    expect(crossGroupRes.status).toBe(403);
  });

  it('US26 Constraint: Removing a student from a group preserves message history in DB', async () => {
    const beforeHistory = await messagesRepository.getDialogMessages(s1, advA);
    expect(beforeHistory.length).toBeGreaterThanOrEqual(2);

    await groupRepository.removeStudent(g1.id, s1);

    const afterHistory = await messagesRepository.getDialogMessages(s1, advA);
    expect(afterHistory.length).toBe(beforeHistory.length);

    const unassignedDialog = await request(app)
      .get('/api/messages/student/dialog')
      .set('Cookie', cookieS1);
    expect(unassignedDialog.status).toBe(200);
    expect(unassignedDialog.body.assigned).toBe(false);
  });
});
