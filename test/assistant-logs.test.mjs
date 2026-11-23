import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.mjs';
import { initDb, pool } from '../server/db.mjs';
import { chatRepository } from '../server/repositories/chat.repository.mjs';
import { chatService } from '../server/services/chat.service.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';
import { assistantLogsService } from '../server/services/assistant-logs.service.mjs';

describe('US25: Review Assistant Conversation Logs', () => {
  const adminUser = 'test_logs_admin';
  const studentCS = 'test_logs_student_cs231';
  const studentIS = 'test_logs_student_is232';
  let adminCookie = '';
  let studentCookie = '';
  let savedGeminiKey;

  beforeAll(async () => {
    savedGeminiKey = process.env.GEMINI_API_KEY;
    await initDb();

    // Admin user + session
    const { rows: adminRows } = await pool.query(
      `INSERT INTO users (username, display_name, role)
       VALUES ('test_logs_admin', 'Logs Admin', 'Administrator')
       ON CONFLICT (username) DO UPDATE SET role = 'Administrator'
       RETURNING id, username`
    );
    const adminSession = 'test_session_logs_admin';
    await pool.query(
      `INSERT INTO sessions (id, user_id, username, role, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [adminSession, adminRows[0]?.id || 981, adminUser, 'Administrator', 'authed']
    );
    adminCookie = `zeme_session=${adminSession}`;

    // Student CS-23-1 + session
    const { rows: csRows } = await pool.query(
      `INSERT INTO users (username, display_name, role)
       VALUES ('test_logs_student_cs231', 'Aibek SecretName', 'Student')
       ON CONFLICT (username) DO UPDATE SET display_name = 'Aibek SecretName', role = 'Student'
       RETURNING id, username`
    );
    const studentSession = 'test_session_logs_student';
    await pool.query(
      `INSERT INTO sessions (id, user_id, username, role, status, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '1 day')
       ON CONFLICT (id) DO NOTHING`,
      [studentSession, csRows[0]?.id || 982, studentCS, 'Student', 'authed']
    );
    studentCookie = `zeme_session=${studentSession}`;

    // Student IS-23-2
    await pool.query(
      `INSERT INTO users (username, display_name, role)
       VALUES ('test_logs_student_is232', 'Dana AnotherName', 'Student')
       ON CONFLICT (username) DO UPDATE SET display_name = 'Dana AnotherName', role = 'Student'
       RETURNING id, username`
    );

    // Create groups CS-23-1 and IS-23-2 & enroll students
    const csGroup = await groupRepository.upsertGroup({
      name: 'CS-23-1',
      program: 'Computer Science',
      study_year: 2,
    });
    const isGroup = await groupRepository.upsertGroup({
      name: 'IS-23-2',
      program: 'Information Systems',
      study_year: 2,
    });
    await groupRepository.enrollStudent(csGroup.id, studentCS);
    await groupRepository.enrollStudent(isGroup.id, studentIS);
  });

  beforeEach(async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.OPENAI_API_KEY;
    await chatRepository.clearMessages(studentCS);
    await chatRepository.clearMessages(studentIS);
  });

  afterAll(async () => {
    if (savedGeminiKey !== undefined) {
      process.env.GEMINI_API_KEY = savedGeminiKey;
    }
    await chatRepository.clearMessages(studentCS);
    await chatRepository.clearMessages(studentIS);
  });

  it('Security Constraint: Non-admin users cannot access assistant logs (401 unauthenticated, 403 student)', async () => {
    await chatService.sendMessage(studentCS, 'Hello, can you help me with my study plan?');

    const unauth = await request(app).get('/api/admin/assistant-logs');
    expect(unauth.status).toBe(401);

    const asStudent = await request(app)
      .get('/api/admin/assistant-logs')
      .set('Cookie', studentCookie);
    expect(asStudent.status).toBe(403);
    expect(JSON.stringify(asStudent.body)).not.toContain('Aibek SecretName');
  });

  it('Anonymization Constraint: Student real names and usernames are hidden by default', async () => {
    await chatService.sendMessage(studentCS, 'Hello, can you help me with my study plan?');

    const res = await request(app)
      .get('/api/admin/assistant-logs')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.anonymizedByDefault).toBe(true);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(1);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(studentCS);
    expect(serialized).not.toContain('Aibek SecretName');
    expect(res.body.logs[0].anonymousStudentId).toMatch(/^Student #[A-F0-9]{6}$/);
  });

  it('QAT Scenario 1: Administrator flags a wrong answer with a comment -> appears in ML Review Queue', async () => {
    const sent = await chatService.sendMessage(studentCS, 'What are semester ECTS limits for registration?');
    const msgId = sent.assistantMessage.id;

    const flagRes = await request(app)
      .post(`/api/admin/assistant-logs/${msgId}/flag`)
      .set('Cookie', adminCookie)
      .send({
        status: 'wrong',
        comment: 'Missed overload exception for GPA >= 3.5',
      });

    expect(flagRes.status).toBe(200);
    expect(flagRes.body.flagStatus).toBe('wrong');
    expect(flagRes.body.mlComment).toBe('Missed overload exception for GPA >= 3.5');

    const logsRes = await request(app)
      .get('/api/admin/assistant-logs?status=wrong')
      .set('Cookie', adminCookie);

    expect(logsRes.status).toBe(200);
    expect(logsRes.body.metrics.flaggedCount).toBeGreaterThanOrEqual(1);
    expect(logsRes.body.metrics.wrongCount).toBeGreaterThanOrEqual(1);

    const queued = logsRes.body.mlReviewQueue.find((item) => item.messageId === msgId);
    expect(queued).toBeDefined();
    expect(queued.flagStatus).toBe('wrong');
    expect(queued.mlComment).toBe('Missed overload exception for GPA >= 3.5');

    // Mark as resolved (Done) in ML Review Queue
    const resolveRes = await request(app)
      .post(`/api/admin/assistant-logs/${msgId}/flag`)
      .set('Cookie', adminCookie)
      .send({
        status: 'resolved',
        comment: 'Fixed in RAG prompt v2',
      });
    expect(resolveRes.status).toBe(200);
    expect(resolveRes.body.flagStatus).toBe('resolved');

    // Remove / unflag from ML Review Queue
    const removeRes = await request(app)
      .delete(`/api/admin/assistant-logs/${msgId}/flag`)
      .set('Cookie', adminCookie);
    expect(removeRes.status).toBe(200);
    expect(removeRes.body.removed).toBe(true);

    const afterRemove = await request(app)
      .get('/api/admin/assistant-logs')
      .set('Cookie', adminCookie);
    expect(afterRemove.body.mlReviewQueue.find((item) => item.messageId === msgId)).toBeUndefined();
  });

  it('QAT Scenario 2: Administrator filters logs by group CS-23-1 and current week', async () => {
    // 1. Recent conversation in CS-23-1 (today / this week)
    await chatService.sendMessage(studentCS, 'How is cumulative GPA calculated?');

    // 2. Old conversation in CS-23-1 (20 days ago — outside current week)
    const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    await chatRepository.addMessage(studentCS, 'user', 'Old question from 20 days ago', { createdAt: twentyDaysAgo });
    await chatRepository.addMessage(studentCS, 'assistant', 'Old answer from 20 days ago', { createdAt: twentyDaysAgo });

    // 3. Recent conversation in IS-23-2 (different group)
    await chatService.sendMessage(studentIS, 'What electives can I take next semester?');

    const res = await request(app)
      .get('/api/admin/assistant-logs?group=CS-23-1&period=week')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBe(1);
    expect(res.body.logs[0].group).toBe('CS-23-1');
    expect(res.body.logs[0].question).toContain('GPA');
  });

  it('Metrics Dashboard accurately reports conversations/day, refusal rate, and flagged answers', async () => {
    // 1 academic question + 1 off-topic refusal
    const academic = await chatService.sendMessage(studentCS, 'How is GPA calculated?');
    await chatService.sendMessage(studentCS, 'I have a fever, what medicine should I take?');

    await assistantLogsService.flagAnswer(
      academic.assistantMessage.id,
      { status: 'helpful', comment: 'Clear GPA explanation' },
      adminUser
    );

    const res = await request(app)
      .get('/api/admin/assistant-logs?group=CS-23-1')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.metrics.totalConversations).toBe(2);
    expect(res.body.metrics.conversationsPerDay).toBe(2);
    expect(res.body.metrics.refusalCount).toBe(1);
    expect(res.body.metrics.refusalRate).toBe(50);
    expect(res.body.metrics.flaggedCount).toBe(1);
    expect(res.body.metrics.helpfulCount).toBe(1);
  });

  it('Retention Job: deletes conversations older than 1 academic year (365 days) while keeping recent logs', async () => {
    const expiredDate = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    await chatRepository.addMessage(studentCS, 'user', 'Question from 400 days ago', { createdAt: expiredDate });
    await chatRepository.addMessage(studentCS, 'assistant', 'Answer from 400 days ago', { createdAt: expiredDate });

    await chatService.sendMessage(studentCS, 'Recent question about roadmap');

    const purgeRes = await request(app)
      .post('/api/admin/assistant-logs/purge')
      .set('Cookie', adminCookie);

    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body.retentionDays).toBe(365);
    expect(purgeRes.body.deletedCount).toBeGreaterThanOrEqual(2);

    const afterRes = await request(app)
      .get('/api/admin/assistant-logs?group=CS-23-1')
      .set('Cookie', adminCookie);

    expect(afterRes.status).toBe(200);
    expect(afterRes.body.logs.length).toBe(1);
    expect(afterRes.body.logs[0].question).toContain('roadmap');
  });
});
