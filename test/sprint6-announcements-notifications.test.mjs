import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.mjs';
import { initDb, pool } from '../server/db.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';

describe('Sprint 6 — US28 & US29: Group Announcements, Read Stats & In-App Notifications', () => {
  const s1 = 's6qat_ann_s1';
  const s2 = 's6qat_ann_s2';
  const sDeparted = 's6qat_ann_departed';
  const advA = 's6qat_ann_adva';
  const advB = 's6qat_ann_advb';

  const groupName = 'S6QAT-ANN-CS23';
  const allUsers = [s1, s2, sDeparted, advA, advB];

  const sidS1 = crypto.randomBytes(24).toString('hex');
  const sidS2 = crypto.randomBytes(24).toString('hex');
  const sidDeparted = crypto.randomBytes(24).toString('hex');
  const sidAdvA = crypto.randomBytes(24).toString('hex');
  const sidAdvB = crypto.randomBytes(24).toString('hex');

  const cookieS1 = `zeme_session=${sidS1}`;
  const cookieS2 = `zeme_session=${sidS2}`;
  const cookieDeparted = `zeme_session=${sidDeparted}`;
  const cookieAdvA = `zeme_session=${sidAdvA}`;
  const cookieAdvB = `zeme_session=${sidAdvB}`;

  let group;

  const cleanup = async () => {
    await pool.query('DELETE FROM sessions WHERE id = ANY($1::text[])', [
      [sidS1, sidS2, sidDeparted, sidAdvA, sidAdvB],
    ]);
    await pool.query('DELETE FROM advisor_messages WHERE student_username = ANY($1::text[]) OR advisor_username = ANY($1::text[])', [
      allUsers,
    ]);
    await pool.query('DELETE FROM group_members WHERE username = ANY($1::text[])', [allUsers]);
    const existing = await groupRepository.findGroupByName(groupName);
    if (existing) await groupRepository.deleteGroup(existing.id);
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

    const idS1 = await insertUser(s1, 'Student Alpha', 'Student');
    const idS2 = await insertUser(s2, 'Student Beta', 'Student');
    const idDep = await insertUser(sDeparted, 'Departed Student', 'Student');
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
      insertSession(sidDeparted, idDep, sDeparted, 'Student'),
      insertSession(sidAdvA, idAdvA, advA, 'Advisor'),
      insertSession(sidAdvB, idAdvB, advB, 'Advisor'),
    ]);

    group = await groupRepository.createGroup({
      name: groupName,
      program: 'Computer Science',
      study_year: 2,
      advisor_username: advA,
    });

    await groupRepository.enrollStudent(group.id, s1);
    await groupRepository.enrollStudent(group.id, s2);
    await groupRepository.enrollStudent(group.id, sDeparted);

    // Departed student leaves the group BEFORE broadcast
    await groupRepository.removeStudent(group.id, sDeparted);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('US29 Validation & ACL: Rejects empty, >2000-char, and unauthorized group announcements', async () => {
    const emptyRes = await request(app)
      .post(`/api/messages/advisor/groups/${group.id}/announcements`)
      .set('Cookie', cookieAdvA)
      .send({ content: '   ' });
    expect(emptyRes.status).toBe(400);

    const longRes = await request(app)
      .post(`/api/messages/advisor/groups/${group.id}/announcements`)
      .set('Cookie', cookieAdvA)
      .send({ content: 'X'.repeat(2001) });
    expect(longRes.status).toBe(400);

    const wrongAdvRes = await request(app)
      .post(`/api/messages/advisor/groups/${group.id}/announcements`)
      .set('Cookie', cookieAdvB)
      .send({ content: 'Unauthorized announcement' });
    expect(wrongAdvRes.status).toBe(403);
  });

  it('US29 Scenarios 1 & 2: Broadcasts to active group members with Announcement badge, excludes departed students, and tracks readCount', async () => {
    const cursor = new Date(Date.now() - 2_000).toISOString();

    const postRes = await request(app)
      .post(`/api/messages/advisor/groups/${group.id}/announcements`)
      .set('Cookie', cookieAdvA)
      .send({ content: 'Meeting on Friday at 14:00' });

    expect(postRes.status).toBe(201);
    expect(postRes.body.announcement.badge).toBe('Announcement');
    expect(postRes.body.announcement.deliveredCount).toBe(2);
    expect(postRes.body.announcement.readCount).toBe(0);

    // Departed student does NOT receive announcement
    const depRes = await request(app)
      .get('/api/messages/student/announcements')
      .set('Cookie', cookieDeparted);
    expect(depRes.status).toBe(200);
    expect(depRes.body.announcements).toHaveLength(0);

    // Active student s1 receives announcement & unread badge increments
    const syncS1 = await request(app)
      .get(`/api/messages/sync?since=${encodeURIComponent(cursor)}`)
      .set('Cookie', cookieS1);
    expect(syncS1.status).toBe(200);
    expect(syncS1.body.unreadAnnouncements).toBe(1);
    expect(syncS1.body.unreadTotal).toBe(1);
    expect(syncS1.body.notifications).toHaveLength(1);
    expect(syncS1.body.notifications[0].badge).toBe('Announcement');

    // s1 opens group channel -> marks read -> advisor readCount increments to 1
    const readRes = await request(app)
      .post('/api/messages/student/announcements/read')
      .set('Cookie', cookieS1);
    expect(readRes.status).toBe(200);
    expect(readRes.body.unreadCount).toBe(0);
    expect(readRes.body.announcements[0].isRead).toBe(true);

    const advStats = await request(app)
      .get(`/api/messages/advisor/groups/${group.id}/announcements`)
      .set('Cookie', cookieAdvA);
    expect(advStats.status).toBe(200);
    expect(advStats.body.announcements[0].deliveredCount).toBe(2);
    expect(advStats.body.announcements[0].readCount).toBe(1);
    expect(advStats.body.announcements[0].unreadCount).toBe(1);
  });

  it('US28 Privacy & Self-Exclusion: Truncates previews to <=75 chars without full content and never notifies sender of own messages', async () => {
    const cursor = new Date(Date.now() - 2_000).toISOString();

    // s2 sends a message -> s2 must NOT receive a notification for own message
    const s2Send = await request(app)
      .post('/api/messages/student/dialog')
      .set('Cookie', cookieS2)
      .send({ content: 'Hello Advisor, checking my graduation credits.' });
    expect(s2Send.status).toBe(201);

    const s2SelfSync = await request(app)
      .get(`/api/messages/sync?since=${encodeURIComponent(cursor)}`)
      .set('Cookie', cookieS2);
    expect(s2SelfSync.body.unreadDirect).toBe(0);
    expect(s2SelfSync.body.notifications.some((n) => n.kind === 'direct')).toBe(false);

    // Advisor sends a long confidential message -> s1 receives <=75-char preview without full content
    const longConfidential = 'PRIVATE TRANSCRIPT DISCUSSION: '.repeat(10);
    await request(app)
      .post(`/api/messages/advisor/threads/${s1}`)
      .set('Cookie', cookieAdvA)
      .send({ content: longConfidential });

    const s1Sync = await request(app)
      .get(`/api/messages/sync?since=${encodeURIComponent(cursor)}`)
      .set('Cookie', cookieS1);
    expect(s1Sync.status).toBe(200);
    expect(s1Sync.body.unreadDirect).toBe(1);
    expect(s1Sync.body.notifications).toHaveLength(1);
    expect(s1Sync.body.notifications[0].content).toBeUndefined();
    expect(s1Sync.body.notifications[0].preview.length).toBeLessThanOrEqual(75);
    expect(s1Sync.body.notifications[0].preview.endsWith('…')).toBe(true);
  });
});
