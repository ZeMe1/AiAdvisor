import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.mjs';
import { initDb, pool } from '../server/db.mjs';
import {
  recommendationService,
  normalizeProgramName,
  isProgramMatching,
} from '../server/services/recommendation.service.mjs';
import { recommendationConfigRepository } from '../server/repositories/recommendation-config.repository.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';
import { scheduleService } from '../server/services/schedule.service.mjs';
import { prerequisiteService } from '../server/services/prerequisite.service.mjs';

describe('US20: Configure the Recommendation Engine', () => {
  let adminCookie = '';

  const cleanup = async () => {
    await pool.query("DELETE FROM sessions WHERE username LIKE 'test_admin_rec%'");
    await pool.query("DELETE FROM users WHERE username LIKE 'test_admin_rec%'");
    await pool.query("DELETE FROM recommendation_configs WHERE created_by LIKE 'test_admin_rec%'");
    await pool.query("DELETE FROM group_members WHERE username LIKE 'test_norm_student%'");
    await pool.query("DELETE FROM student_groups WHERE name LIKE 'TEST_NORM_%'");
    // Ensure the latest remaining config is marked active
    await pool.query(`
      UPDATE recommendation_configs 
      SET is_active = true 
      WHERE id = (SELECT id FROM recommendation_configs ORDER BY version DESC LIMIT 1)
    `);
  };

  beforeAll(async () => {
    await initDb();
    await cleanup();

    // Create Administrator user and session
    const { rows: userRows } = await pool.query(
      `INSERT INTO users (username, display_name, role)
       VALUES ('test_admin_rec', 'Test Admin Rec', 'Administrator')
       RETURNING id, username`
    );
    const adminUser = userRows[0];

    const sessionId = 'test_session_admin_rec_token';
    await pool.query(
      `INSERT INTO sessions (id, user_id, username, role, status, expires_at)
       VALUES ($1, $2, 'test_admin_rec', 'Administrator', 'authed', NOW() + INTERVAL '1 day')`,
      [sessionId, adminUser.id]
    );
    adminCookie = `zeme_session=${sessionId}`;
  }, 15000);

  afterAll(async () => {
    await cleanup();
  }, 15000);

  it('Administrator retrieves active recommendation engine configuration and history', async () => {
    const res = await request(app)
      .get('/api/admin/recommendations/config')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('config');
    expect(res.body).toHaveProperty('history');
    expect(res.body.config).toHaveProperty('version');
    expect(res.body.config).toHaveProperty('min_ects');
    expect(res.body.config).toHaveProperty('max_ects');
    expect(res.body.config.min_ects).toBeGreaterThanOrEqual(20);
    expect(res.body.config.max_ects).toBeLessThanOrEqual(40);
  });

  it('Scenario 1: Administrator changes ECTS limit (e.g. max 25 ECTS) and saves new configuration version', async () => {
    const { rows: maxRows } = await pool.query(
      'SELECT COALESCE(MAX(version), 0) AS max_ver FROM recommendation_configs'
    );
    const expectedVer = Number(maxRows[0].max_ver) + 1;

    const res = await request(app)
      .put('/api/admin/recommendations/config')
      .set('Cookie', adminCookie)
      .send({
        min_ects: 20,
        max_ects: 25,
        gpa_weight: 1.2,
        retake_weight: 2.5,
        interest_weight: 1.8,
        disabled_programs: ['Robotics'],
      });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(expectedVer);
    expect(res.body.min_ects).toBe(20);
    expect(res.body.max_ects).toBe(25);
    expect(res.body.gpa_weight).toBe(1.2);
    expect(res.body.is_active).toBe(true);

    // Active config in DB must reflect version update
    const active = await recommendationConfigRepository.getActiveConfig();
    expect(active.max_ects).toBe(25);
    expect(active.version).toBe(res.body.version);
  });

  it('Scenario 2: Administrator saves invalid configuration (min > max, e.g. min 25, max 20) -> rejected with 400', async () => {
    const previousConfig = await recommendationConfigRepository.getActiveConfig();

    const res = await request(app)
      .put('/api/admin/recommendations/config')
      .set('Cookie', adminCookie)
      .send({
        min_ects: 25,
        max_ects: 20,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Min cannot be greater than max');

    // Active configuration must remain unchanged
    const currentActive = await recommendationConfigRepository.getActiveConfig();
    expect(currentActive.version).toBe(previousConfig.version);
    expect(currentActive.max_ects).toBe(previousConfig.max_ects);
  });

  it('Enforces university semester boundary constraints: min ECTS cannot be below 20', async () => {
    const res = await request(app)
      .put('/api/admin/recommendations/config')
      .set('Cookie', adminCookie)
      .send({
        min_ects: 15, // Below 20
        max_ects: 30,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Minimum semester registration limit cannot be less than 20 ECTS');
  });

  it('Enforces university semester boundary constraints: max ECTS cannot exceed 40', async () => {
    const res = await request(app)
      .put('/api/admin/recommendations/config')
      .set('Cookie', adminCookie)
      .send({
        min_ects: 20,
        max_ects: 45, // Above 40
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Maximum semester registration limit cannot exceed 40 ECTS');
  });

  it('Disables recommendations for specified programs when configured in disabled_programs', async () => {
    // 1. Configure "Disabled Program"
    await request(app)
      .put('/api/admin/recommendations/config')
      .set('Cookie', adminCookie)
      .send({
        min_ects: 20,
        max_ects: 30,
        disabled_programs: ['Robotics Engineering'],
      });

    // 2. Generate recommendations for a student in this program
    const mockCurriculum = {
      program: { title: 'Robotics Engineering', name: 'Robotics Engineering' },
      semesters: [
        {
          no: 1,
          courses: [{ code: 'ROB 101', name: 'Intro', ects: 5, status: 'available' }],
        },
      ],
    };

    const currSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evalSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: { 'ROB 101': { eligible: true } },
    });

    const recs = await recommendationService.getRecommendations({ localUsername: 'test_robotics_student' });
    expect(recs.isProgramDisabled).toBe(true);
    expect(recs.allRecommendations).toHaveLength(0);
    expect(recs.recommendedSet).toHaveLength(0);

    currSpy.mockRestore();
    evalSpy.mockRestore();
  }, 15000);

  it('normalizeProgramName correctly strips year prefixes, language tags, and spaces', () => {
    expect(normalizeProgramName('2024-Information Systems (EN)')).toBe('information systems');
    expect(normalizeProgramName('Information Systems (EN) / 2024')).toBe('information systems');
    expect(normalizeProgramName('Computer Science (KZ)')).toBe('computer science');
    expect(normalizeProgramName('Cyber Security (RU)')).toBe('cyber security');
    expect(normalizeProgramName('Mathematical and Computer Science')).toBe('mathematical and computer science');
  });

  it('isProgramMatching matches canonical names against SDU portal formatted names', () => {
    expect(isProgramMatching('2024-Information Systems (EN)', 'Information Systems')).toBe(true);
    expect(isProgramMatching('Information Systems (EN)', 'Information Systems')).toBe(true);
    expect(isProgramMatching('Computer Science', 'Computer Science')).toBe(true);
    expect(isProgramMatching('Computer Science', 'Information Systems')).toBe(false);
  });

  it('Disables recommendations for SDU portal names with language suffixes like (EN) when canonical name is disabled', async () => {
    // 1. Disable "Information Systems"
    await request(app)
      .put('/api/admin/recommendations/config')
      .set('Cookie', adminCookie)
      .send({
        min_ects: 20,
        max_ects: 30,
        disabled_programs: ['Information Systems'],
      });

    // 2. Mock SDU curriculum with "2024-Information Systems (EN)"
    const mockCurriculum = {
      program: {
        title: '2024-Information Systems (EN)',
        name: 'Information Systems (EN)',
        year: 2024,
        track: 'Main Track',
      },
      semesters: [
        {
          no: 1,
          courses: [{ code: 'INF 101', name: 'Intro to IS', ects: 5, status: 'available' }],
        },
      ],
    };

    const currSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evalSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: { 'INF 101': { eligible: true } },
    });

    const recs = await recommendationService.getRecommendations({ localUsername: 'test_sdu_student' });
    expect(recs.isProgramDisabled).toBe(true);
    expect(recs.studentProgram).toBe('Information Systems');
    expect(recs.disabledReason).toContain('Information Systems');
    expect(recs.recommendedSet).toHaveLength(0);
    expect(recs.allRecommendations).toHaveLength(0);

    currSpy.mockRestore();
    evalSpy.mockRestore();
  }, 15000);

  it('Disables recommendations when student belongs to an academic group with a disabled program', async () => {
    // 1. Create a group with program 'Cyber Security' and enroll test student
    const testUser = 'test_norm_student_cs';
    const group = await groupRepository.createGroup({
      name: 'TEST_NORM_CS_GROUP',
      program: 'Cyber Security',
      study_year: 2,
    });
    await groupRepository.enrollStudent(group.id, testUser);

    // 2. Disable 'Cyber Security' in recommendation config
    await request(app)
      .put('/api/admin/recommendations/config')
      .set('Cookie', adminCookie)
      .send({
        min_ects: 20,
        max_ects: 30,
        disabled_programs: ['Cyber Security'],
      });

    // 3. SDU curriculum has generic track name
    const mockCurriculum = {
      program: { title: 'General Track', name: 'General Track' },
      semesters: [
        {
          no: 1,
          courses: [{ code: 'SEC 101', name: 'Security Basics', ects: 5, status: 'available' }],
        },
      ],
    };

    const currSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evalSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: { 'SEC 101': { eligible: true } },
    });

    const recs = await recommendationService.getRecommendations({ localUsername: testUser });
    expect(recs.isProgramDisabled).toBe(true);
    expect(recs.studentProgram).toBe('Cyber Security');

    currSpy.mockRestore();
    evalSpy.mockRestore();
  }, 15000);

  it('Populates scoreBreakdown structure with base, retakeBoost, gpaBoost, interestBoost on every recommendation', async () => {
    const mockCurriculum = {
      program: { title: 'General Program', name: 'General Program' },
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'ENG 101', name: 'English', ects: 5, status: 'passed', grade: 'A' }, // 4.0 * 5 = 20
            { code: 'CRS 101', name: 'Core Course', ects: 5, status: 'available' },
            { code: 'ELE 201', name: 'Elective Course', ects: 5, status: 'available', isElective: true },
          ],
        },
      ],
    };

    const currSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evalSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: {
        'CRS 101': { eligible: true },
        'ELE 201': { eligible: true },
      },
    });

    const recs = await recommendationService.getRecommendations({ localUsername: 'test_breakdown_student' });
    expect(recs.allRecommendations.length).toBeGreaterThan(0);

    for (const c of recs.allRecommendations) {
      expect(c).toHaveProperty('scoreBreakdown');
      expect(c.scoreBreakdown).toHaveProperty('base');
      expect(c.scoreBreakdown).toHaveProperty('gpaBoost');
      expect(c.scoreBreakdown).toHaveProperty('interestBoost');
      expect(c.scoreBreakdown).toHaveProperty('retakeBoost');
      expect(c.scoreBreakdown.total).toBe(c.score);
    }

    currSpy.mockRestore();
    evalSpy.mockRestore();
  }, 15000);

  it('GPA weight dynamically scales elective scores proportionally to student GPA', async () => {
    const mockCurriculum = {
      program: { title: 'General Program', name: 'General Program' },
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'ENG 101', name: 'English', ects: 5, status: 'passed', grade: 'A' }, // GPA 4.0
            { code: 'ELE 201', name: 'Elective Course', ects: 5, status: 'available', isElective: true },
          ],
        },
      ],
    };

    const currSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evalSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: { 'ELE 201': { eligible: true } },
    });

    // Run with low GPA weight (0.5)
    const lowConfigSpy = vi.spyOn(recommendationConfigRepository, 'getActiveConfig').mockResolvedValue({
      version: 1,
      min_ects: 20,
      max_ects: 25,
      gpa_weight: 0.5,
      retake_weight: 2.0,
      interest_weight: 1.5,
      disabled_programs: [],
      is_active: true,
    });
    const lowRecs = await recommendationService.getRecommendations({ localUsername: 'test_gpa_low' });
    const lowScore = lowRecs.allRecommendations[0].score;
    lowConfigSpy.mockRestore();

    // Run with high GPA weight (2.5)
    const highConfigSpy = vi.spyOn(recommendationConfigRepository, 'getActiveConfig').mockResolvedValue({
      version: 2,
      min_ects: 20,
      max_ects: 25,
      gpa_weight: 2.5,
      retake_weight: 2.0,
      interest_weight: 1.5,
      disabled_programs: [],
      is_active: true,
    });
    const highRecs = await recommendationService.getRecommendations({ localUsername: 'test_gpa_high' });
    const highScore = highRecs.allRecommendations[0].score;
    highConfigSpy.mockRestore();

    expect(highScore).toBeGreaterThan(lowScore);
    expect(highRecs.allRecommendations[0].scoreBreakdown.gpaBoost).toBeGreaterThan(
      lowRecs.allRecommendations[0].scoreBreakdown.gpaBoost
    );

    currSpy.mockRestore();
    evalSpy.mockRestore();
  }, 15000);

  it('Interest weight dynamically scales the boost for liked courses', async () => {
    const mockCurriculum = {
      program: { title: 'General Program', name: 'General Program' },
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'CRS 101', name: 'Course 101', ects: 5, status: 'available' },
          ],
        },
      ],
    };

    const currSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evalSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: { 'CRS 101': { eligible: true } },
    });

    const fbUser = 'rec_cfg_interest_weight_user';
    await recommendationService.submitFeedback({ localUsername: fbUser }, {
      courseCode: 'CRS 101',
      isInterested: true,
    });

    // Run with standard interest weight (1.0)
    const stdConfigSpy = vi.spyOn(recommendationConfigRepository, 'getActiveConfig').mockResolvedValue({
      version: 1,
      min_ects: 20,
      max_ects: 25,
      gpa_weight: 1.0,
      retake_weight: 2.0,
      interest_weight: 1.0,
      disabled_programs: [],
      is_active: true,
    });
    const stdRecs = await recommendationService.getRecommendations({ localUsername: fbUser });
    const stdBoost = stdRecs.allRecommendations[0].scoreBreakdown.interestBoost;
    stdConfigSpy.mockRestore();

    // Run with high interest weight (3.0)
    const highConfigSpy = vi.spyOn(recommendationConfigRepository, 'getActiveConfig').mockResolvedValue({
      version: 2,
      min_ects: 20,
      max_ects: 25,
      gpa_weight: 1.0,
      retake_weight: 2.0,
      interest_weight: 3.0,
      disabled_programs: [],
      is_active: true,
    });
    const highRecs = await recommendationService.getRecommendations({ localUsername: fbUser });
    const highBoost = highRecs.allRecommendations[0].scoreBreakdown.interestBoost;
    highConfigSpy.mockRestore();

    expect(highBoost).toBeGreaterThan(stdBoost);
    expect(highRecs.allRecommendations[0].score).toBeGreaterThan(stdRecs.allRecommendations[0].score);

    currSpy.mockRestore();
    evalSpy.mockRestore();
  }, 15000);

  it('Administrator can reset recommendation engine to default configuration', async () => {
    const res = await request(app)
      .post('/api/admin/recommendations/config/reset')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body.min_ects).toBe(20);
    expect(res.body.max_ects).toBe(21);
    expect(res.body.disabled_programs).toHaveLength(0);
  });
});
