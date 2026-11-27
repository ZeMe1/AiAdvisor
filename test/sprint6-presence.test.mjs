import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.mjs';
import { initDb, pool } from '../server/db.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';
import { presenceService, formatSeenTime } from '../server/services/presence.service.mjs';

describe('Sprint 6 — US30: Advisor Online Status, Office Hours & Presence Privacy', () => {
  const s1 = 's6qat_pres_s1';
  const sOther = 's6qat_pres_sother';
  const advA = 's6qat_pres_adva';
  const advB = 's6qat_pres_advb';

  const groupNames = ['S6QAT-PRES-G1', 'S6QAT-PRES-G2'];
  const allUsers = [s1, sOther, advA, advB];

  const sidS1 = crypto.randomBytes(24).toString('hex');
  const sidSOther = crypto.randomBytes(24).toString('hex');
  const sidAdvA = crypto.randomBytes(24).toString('hex');

  const cookieS1 = `zeme_session=${sidS1}`;
  const cookieSOther = `zeme_session=${sidSOther}`;
  const cookieAdvA = `zeme_session=${sidAdvA}`;

  const cleanup = async () => {
    await pool.query('DELETE FROM sessions WHERE id = ANY($1::text[])', [[sidS1, sidSOther, sidAdvA]]);
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

    const idS1 = await insertUser(s1, 'Student Pres 1', 'Student');
    const idSOther = await insertUser(sOther, 'Student Pres Other', 'Student');
    const idAdvA = await insertUser(advA, 'Dr. Presence A', 'Advisor');
    await insertUser(advB, 'Dr. Presence B', 'Advisor');

    const insertSession = async (sid, uid, uname, role) => {
      await pool.query(
        `INSERT INTO sessions (id, user_id, username, role, status, sdu_jar)
         VALUES ($1, $2, $3, $4, 'authed', '{}'::jsonb)`,
        [sid, uid, uname, role]
      );
    };

    await Promise.all([
      insertSession(sidS1, idS1, s1, 'Student'),
      insertSession(sidSOther, idSOther, sOther, 'Student'),
      insertSession(sidAdvA, idAdvA, advA, 'Advisor'),
    ]);

    const g1 = await groupRepository.createGroup({
      name: groupNames[0],
      program: 'Computer Science',
      study_year: 2,
      advisor_username: advA,
    });
    const g2 = await groupRepository.createGroup({
      name: groupNames[1],
      program: 'Information Systems',
      study_year: 2,
      advisor_username: advB,
    });

    await groupRepository.enrollStudent(g1.id, s1);
    await groupRepository.enrollStudent(g2.id, sOther);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('US30 Scenario 1: Active advisor appears Online, idle 3m appears Away, and office hours are saved', async () => {
    // Student cannot configure office hours
    const studentOhRes = await request(app)
      .put('/api/messages/presence/office-hours')
      .set('Cookie', cookieS1)
      .send({ office_hours: 'Mon 10:00' });
    expect(studentOhRes.status).toBe(403);

    // Advisor configures office hours
    const ohRes = await request(app)
      .put('/api/messages/presence/office-hours')
      .set('Cookie', cookieAdvA)
      .send({
        office_hours: 'Mon, Wed 14:00-16:00',
        response_time_note: 'Usually replies within 2 hours',
      });
    expect(ohRes.status).toBe(200);
    expect(ohRes.body.officeHours).toBe('Mon, Wed 14:00-16:00');

    // Active <= 2m -> Online
    await presenceService.touchUserPresence(advA, true, new Date(Date.now() - 30_000).toISOString());
    const onlineRes = await request(app)
      .get('/api/messages/presence/advisor')
      .set('Cookie', cookieS1);
    expect(onlineRes.status).toBe(200);
    expect(onlineRes.body.presence.status).toBe('online');
    expect(onlineRes.body.presence.statusText).toBe('Online');
    expect(onlineRes.body.presence.officeHours).toBe('Mon, Wed 14:00-16:00');

    // Idle 3m -> Away
    await presenceService.touchUserPresence(advA, true, new Date(Date.now() - 3 * 60_000).toISOString());
    const awayRes = await request(app)
      .get('/api/messages/presence/advisor')
      .set('Cookie', cookieS1);
    expect(awayRes.status).toBe(200);
    expect(awayRes.body.presence.status).toBe('away');
    expect(awayRes.body.presence.statusText).toBe('Away');
  });

  it('US30 Scenario 2: Inactive (>5m) advisor displays "Offline, was seen at HH:MM" alongside office hours', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000);
    await presenceService.touchUserPresence(advA, true, tenMinAgo.toISOString());

    const res = await request(app)
      .get('/api/messages/presence/advisor')
      .set('Cookie', cookieS1);

    expect(res.status).toBe(200);
    expect(res.body.presence.status).toBe('offline');
    expect(res.body.presence.statusText).toBe(`Offline, was seen at ${formatSeenTime(tenMinAgo)}`);
    expect(res.body.presence.officeHours).toBe('Mon, Wed 14:00-16:00');
  });

  it('US30 Guardrails: Blocked advisor never shows Online, and students from other groups receive 403', async () => {
    // Student from Group 2 cannot inspect Group 1 Advisor A's status
    const privacyRes = await request(app)
      .get(`/api/messages/presence/advisor?advisor=${advA}`)
      .set('Cookie', cookieSOther);
    expect(privacyRes.status).toBe(403);
    expect(privacyRes.body.error).toBe('You can only message your own group advisor');

    // Even if Advisor A was just active, blocking Advisor A forces Offline
    await presenceService.touchUserPresence(advA, true, new Date().toISOString());
    await pool.query('UPDATE users SET is_blocked = true WHERE username = $1', [advA]);

    const blockedRes = await request(app)
      .get('/api/messages/presence/advisor')
      .set('Cookie', cookieS1);
    expect(blockedRes.status).toBe(200);
    expect(blockedRes.body.presence.status).toBe('offline');
    expect(blockedRes.body.presence.isOnline).toBe(false);
    expect(blockedRes.body.presence.statusText).toBe('Offline');
  });
});
