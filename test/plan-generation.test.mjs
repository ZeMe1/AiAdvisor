import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDb, pool } from '../server/db.mjs';
import { planService } from '../server/services/plan.service.mjs';
import { planRepository } from '../server/repositories/plan.repository.mjs';
import { scheduleService } from '../server/services/schedule.service.mjs';
import { prerequisiteService } from '../server/services/prerequisite.service.mjs';
import { curriculumService } from '../server/services/curriculum.service.mjs';
import { recommendationConfigRepository } from '../server/repositories/recommendation-config.repository.mjs';

describe('US17: Generate a Personalized Semester Study Plan', () => {
  const TEST_USER = 'test_plan_student_us17';

  beforeAll(async () => {
    await initDb();
    await pool.query('DELETE FROM student_semester_plans WHERE username = $1', [TEST_USER]);
  }, 15000);

  afterAll(async () => {
    await pool.query('DELETE FROM student_semester_plans WHERE username = $1', [TEST_USER]);
    vi.restoreAllMocks();
  }, 15000);

  const mockCurriculum = {
    program: { title: 'Computer Science', track: 'General', year: 2024 },
    semesters: [
      {
        no: 1,
        courses: [
          { code: 'CSS 105', name: 'Fundamentals of Programming', ects: 5, credits: 3, status: 'passed', grade: 'A' },
          { code: 'MAT 137', name: 'Mathematics 1', ects: 5, credits: 3, status: 'passed', grade: 'B' },
          { code: 'MDE 162', name: 'Academic English 1', ects: 5, credits: 3, status: 'passed', grade: 'A' },
        ],
      },
      {
        no: 2,
        courses: [
          { code: 'CSS 108', name: 'Programming Technologies', ects: 5, credits: 3, status: 'passed', grade: 'B+' },
          // Failed course from Semester 2: Retake requirement!
          { code: 'MAT 138', name: 'Mathematics 2', ects: 5, credits: 3, status: 'failed', grade: 'F' },
          { code: 'MDE 171', name: 'Academic English 2', ects: 5, credits: 3, status: 'passed', grade: 'B' },
        ],
      },
      {
        no: 3,
        courses: [
          { code: 'CSS 215', name: 'Data Structures & Algorithms', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'CSS 216', name: 'Mobile App Development', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'INF 318', name: 'Computer Networks', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'MDE 291', name: 'Philosophy', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'XXX 001', name: 'Elective: Machine Learning', ects: 5, credits: 3, status: 'available', grade: null, isElective: true },
          { code: 'XXX 002', name: 'Elective: Cloud Computing', ects: 5, credits: 5, status: 'available', grade: null, isElective: true },
        ],
      },
      {
        no: 4,
        courses: [
          { code: 'CSS 311', name: 'Operating Systems', ects: 5, credits: 3, status: 'available', grade: null },
          { code: 'INF 325', name: 'Database Systems', ects: 5, credits: 3, status: 'available', grade: null },
        ],
      },
    ],
  };

  const mockEligibilityMap = {
    'MAT 138': { eligible: true, status: 'eligible' },
    'CSS 215': { eligible: true, status: 'eligible' },
    'CSS 216': { eligible: true, status: 'eligible' },
    'INF 318': { eligible: true, status: 'eligible' },
    'MDE 291': { eligible: true, status: 'eligible' },
    'XXX 001': { eligible: true, status: 'eligible' },
    'XXX 002': { eligible: true, status: 'eligible' },
    'CSS 311': { eligible: false, status: 'not_eligible', missingPrereqs: ['CSS 215'] },
    'INF 325': { eligible: false, status: 'not_eligible', missingPrereqs: ['CSS 215'] },
  };

  it('Scenario 1: Generates study plan prioritizing retakes, current mandatory courses, and electives within ECTS limit (<15s)', async () => {
    vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({ courses: mockEligibilityMap });
    vi.spyOn(recommendationConfigRepository, 'getActiveConfig').mockResolvedValue({
      min_ects: 20,
      max_ects: 25,
    });

    const client = { localUsername: TEST_USER };
    const startTime = Date.now();

    const plan = await planService.generatePersonalizedPlan(client, { targetSemester: 3, maxEcts: 25 });
    const duration = Date.now() - startTime;

    // Performance criteria: Must execute well within 15 seconds (15,000 ms)
    expect(duration).toBeLessThan(15000);
    expect(plan.success).toBe(true);
    expect(plan.targetSemester).toBe(3);
    expect(plan.minEctsLimit).toBe(20);
    expect(plan.maxEctsLimit).toBe(25);

    // Verify Priority 1: Retake course MAT 138 (failed in sem 2) MUST be first
    expect(plan.courses[0].code).toBe('MAT 138');
    expect(plan.courses[0].isRetake).toBe(true);
    expect(plan.courses[0].reason).toContain('Failed course retake');

    // Verify Priority 2: Core mandatory courses for Semester 3
    const coreCodes = plan.courses.slice(1).map((c) => c.code);
    expect(coreCodes).toContain('CSS 215');
    expect(coreCodes).toContain('CSS 216');
    expect(coreCodes).toContain('INF 318');
    expect(coreCodes).toContain('MDE 291');

    // Verify total ECTS complies with limit
    expect(plan.totalEcts).toBeLessThanOrEqual(25);
    expect(plan.isWithinLimit).toBe(true);
    expect(plan.isOverLimit).toBe(false);
  });

  it('Scenario 2: Approved study plan is persisted in database and reflected on Curriculum Roadmap with isPlanned badge', async () => {
    vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({ courses: mockEligibilityMap });

    const client = { localUsername: TEST_USER };

    const approvedCourses = [
      { code: 'MAT 138', name: 'Mathematics 2', ects: 5, isRetake: true },
      { code: 'CSS 215', name: 'Data Structures & Algorithms', ects: 5, isMandatory: true },
      { code: 'CSS 216', name: 'Mobile App Development', ects: 5, isMandatory: true },
      { code: 'XXX 001', name: 'Elective: Machine Learning', ects: 5, isMandatory: false },
    ];

    // 1. Save approved plan
    const saveResult = await planService.saveApprovedPlan(client, {
      targetSemester: 3,
      courses: approvedCourses,
      totalEcts: 20,
    });

    expect(saveResult.success).toBe(true);
    expect(saveResult.plan).toBeDefined();
    expect(saveResult.plan.username).toBe(TEST_USER);
    expect(saveResult.plan.target_semester).toBe(3);
    expect(saveResult.plan.total_ects).toBe(20);
    expect(saveResult.plan.is_approved).toBe(true);

    // 2. Retrieve saved plan
    const fetched = await planService.getApprovedPlan(client, 3);
    expect(fetched.success).toBe(true);
    expect(fetched.plan.courses.length).toBe(4);
    expect(fetched.plan.courses.map((c) => c.code)).toEqual(['MAT 138', 'CSS 215', 'CSS 216', 'XXX 001']);

    // 3. Verify student roadmap reflects planned courses with isPlanned: true
    const roadmapData = await curriculumService.getRoadmapCurriculumsForStudent(
      TEST_USER,
      mockCurriculum.semesters.flatMap((s) => s.courses),
      mockCurriculum
    );

    const sduRoadmap = roadmapData.curriculums.find((c) => c.id === 'sdu');
    expect(sduRoadmap).toBeDefined();

    const sem2Courses = sduRoadmap.semesters.find((s) => s.no === 2)?.courses || [];
    const mat138 = sem2Courses.find((c) => c.code === 'MAT 138');
    expect(mat138).toBeDefined();
    expect(mat138.isPlanned).toBe(true);

    const sem3Courses = sduRoadmap.semesters.find((s) => s.no === 3)?.courses || [];
    const css215 = sem3Courses.find((c) => c.code === 'CSS 215');
    const css216 = sem3Courses.find((c) => c.code === 'CSS 216');
    const mde291 = sem3Courses.find((c) => c.code === 'MDE 291');

    expect(css215.isPlanned).toBe(true);
    expect(css216.isPlanned).toBe(true);
    // MDE 291 was not in the approved plan -> isPlanned must be false
    expect(mde291.isPlanned).toBe(false);
  });
});
