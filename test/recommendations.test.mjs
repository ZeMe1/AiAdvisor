import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { initDb, pool } from '../server/db.mjs';
import { recommendationService } from '../server/services/recommendation.service.mjs';
import { scheduleService } from '../server/services/schedule.service.mjs';
import { prerequisiteService } from '../server/services/prerequisite.service.mjs';
import { recommendationConfigRepository } from '../server/repositories/recommendation-config.repository.mjs';

describe('US16: Get Personalized Course Recommendations', () => {
  beforeAll(async () => {
    await initDb();
    await pool.query("DELETE FROM recommendation_feedback WHERE username LIKE 'test_%'");
  }, 15000);

  afterAll(async () => {
    await pool.query("DELETE FROM recommendation_feedback WHERE username LIKE 'test_%'");
  }, 15000);
  it('Scenario 1: Generates ranked course recommendations with reasons and mandatory badges for eligible courses', async () => {
    // Mock student curriculum with completed 2 semesters with GPA 3.20
    const mockCurriculum = {
      program: { title: 'Computer Science', track: 'General' },
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'CSS 105', name: 'Fundamentals of Programming', ects: 5, credits: 3, status: 'passed', grade: 'B+' }, // 3.33 * 5 = 16.65
            { code: 'MAT 137', name: 'Mathematics 1', ects: 5, credits: 3, status: 'passed', grade: 'B' }, // 3.0 * 5 = 15.0
            { code: 'MDE 162', name: 'Academic English 1', ects: 5, credits: 3, status: 'passed', grade: 'B+' }, // 3.33 * 5 = 16.65
          ],
        },
        {
          no: 2,
          courses: [
            { code: 'CSS 108', name: 'Programming Technologies', ects: 5, credits: 3, status: 'passed', grade: 'B' }, // 3.0 * 5 = 15.0
            { code: 'MAT 138', name: 'Mathematics 2', ects: 5, credits: 3, status: 'passed', grade: 'B+' }, // 3.33 * 5 = 16.65
            { code: 'MDE 171', name: 'Academic English 2', ects: 5, credits: 3, status: 'passed', grade: 'B' }, // 3.0 * 5 = 15.0
          ],
        },
        {
          no: 3,
          courses: [
            { code: 'CSS 215', name: 'Data Structures & Algorithms', ects: 5, credits: 3, status: 'available', grade: null },
            { code: 'CSS 216', name: 'Mobile Application Development', ects: 5, credits: 3, status: 'available', grade: null },
            { code: 'INF 318', name: 'Computer Networks', ects: 5, credits: 3, status: 'available', grade: null },
            { code: 'MDE 291', name: 'Philosophy', ects: 5, credits: 3, status: 'available', grade: null },
            { code: 'XXX 001', name: 'Major Elective 1', ects: 5, credits: 3, status: 'available', grade: null, isElective: true },
          ],
        },
        {
          no: 4,
          courses: [
            { code: 'CSS 311', name: 'Operating Systems', ects: 5, credits: 3, status: 'available', grade: null },
            { code: 'CSS 405', name: 'Artificial Intelligence', ects: 5, credits: 3, status: 'available', grade: null },
          ],
        },
      ],
    };

    const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: {
        'CSS 215': { eligible: true, status: 'eligible' },
        'CSS 216': { eligible: true, status: 'eligible' },
        'INF 318': { eligible: true, status: 'eligible' },
        'MDE 291': { eligible: true, status: 'eligible' },
        'XXX 001': { eligible: true, status: 'eligible' },
        'CSS 311': { eligible: true, status: 'eligible' },
        'CSS 405': { eligible: false, status: 'not_eligible' }, // Locked
      },
    });

    const res = await recommendationService.getRecommendations({ localUsername: 'test_student_rec' });

    expect(getCurriculumSpy).toHaveBeenCalled();
    expect(res).toBeDefined();

    // Cumulative GPA calculation: (16.65 + 15.0 + 16.65 + 15.0 + 16.65 + 15.0) / 30 = 94.95 / 30 ≈ 3.17 ~ 3.20
    expect(Number(res.gpa)).toBeGreaterThanOrEqual(3.0);
    expect(res.targetSemester).toBe(3);

    // Locked courses (CSS 405) must NOT be recommended
    const recommendedCodes = res.allRecommendations.map((r) => r.code);
    expect(recommendedCodes).not.toContain('CSS 405');

    // Mandatory courses must be marked isMandatory = true
    const css215 = res.allRecommendations.find((r) => r.code === 'CSS 215');
    expect(css215).toBeDefined();
    expect(css215.isMandatory).toBe(true);
    expect(css215.reason).toContain('Required core curriculum course for Semester 3');

    // Elective courses must be marked isMandatory = false
    const elective = res.allRecommendations.find((r) => r.code === 'XXX 001');
    expect(elective).toBeDefined();
    expect(elective.isMandatory).toBe(false);
    expect(elective.reason).toContain('elective');

    getCurriculumSpy.mockRestore();
    evaluateSpy.mockRestore();
  });

  it('Scenario 2: Recommendations respect the 21 ECTS semester limit', async () => {
    const mockCurriculum = {
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'CRS 1', name: 'Course 1', ects: 5, status: 'available' },
            { code: 'CRS 2', name: 'Course 2', ects: 5, status: 'available' },
            { code: 'CRS 3', name: 'Course 3', ects: 5, status: 'available' },
            { code: 'CRS 4', name: 'Course 4', ects: 5, status: 'available' },
            { code: 'CRS 5', name: 'Course 5', ects: 5, status: 'available' },
            { code: 'CRS 6', name: 'Course 6', ects: 5, status: 'available' },
          ],
        },
      ],
    };

    const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: {
        'CRS 1': { eligible: true },
        'CRS 2': { eligible: true },
        'CRS 3': { eligible: true },
        'CRS 4': { eligible: true },
        'CRS 5': { eligible: true },
        'CRS 6': { eligible: true },
      },
    });
    const configSpy = vi.spyOn(recommendationConfigRepository, 'getActiveConfig').mockResolvedValue({
      version: 1,
      min_ects: 20,
      max_ects: 21,
      gpa_weight: 1.0,
      retake_weight: 2.0,
      interest_weight: 1.5,
      disabled_programs: [],
      is_active: true,
    });

    const res = await recommendationService.getRecommendations({ localUsername: 'test_student_limit' });

    expect(res.maxEctsLimit).toBe(21);
    expect(res.recommendedEctsTotal).toBeLessThanOrEqual(21);
    // 4 courses of 5 ECTS = 20 ECTS (adding 5th course would exceed 21)
    expect(res.recommendedSet).toHaveLength(4);
    expect(res.recommendedEctsTotal).toBe(20);

    getCurriculumSpy.mockRestore();
    evaluateSpy.mockRestore();
    configSpy.mockRestore();
  });

  it('Prioritizes failed courses (retakes) with high score and retake reason', async () => {
    const mockCurriculum = {
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'CSS 105', name: 'Fundamentals of Programming', ects: 5, status: 'failed', grade: 'F' },
          ],
        },
        {
          no: 2,
          courses: [
            { code: 'CSS 108', name: 'Programming Tech', ects: 5, status: 'available' },
          ],
        },
      ],
    };

    const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
    const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
      courses: {
        'CSS 105': { eligible: true },
        'CSS 108': { eligible: true },
      },
    });

    const res = await recommendationService.getRecommendations({ localUsername: 'test_student_retake' });
    expect(res.allRecommendations[0].code).toBe('CSS 105');
    expect(res.allRecommendations[0].isRetake).toBe(true);
    expect(res.allRecommendations[0].reason).toContain('failed');

    getCurriculumSpy.mockRestore();
    evaluateSpy.mockRestore();
  });

  describe('US19: Give Feedback on Recommendations', () => {
    const mockCurriculum = {
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'CSS 105', name: 'Fundamentals of Programming', ects: 5, status: 'available', isElective: false },
            { code: 'XXX 001', name: 'Web Elective', ects: 5, status: 'available', isElective: true },
          ],
        },
      ],
    };

    it('Scenario 1: Marking an elective as not interesting downgrades it and excludes it from recommended set', async () => {
      const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
      const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
        courses: {
          'CSS 105': { eligible: true },
          'XXX 001': { eligible: true },
        },
      });

      const client = { localUsername: 'test_student_fb_1' };

      // Submit dislike on elective
      const feedbackRes = await recommendationService.submitFeedback(client, {
        courseCode: 'XXX 001',
        isInterested: false,
      });

      expect(feedbackRes.success).toBe(true);
      expect(feedbackRes.isMandatory).toBe(false);
      expect(feedbackRes.canHide).toBe(true);

      // Verify next recommendation generation reflects feedback
      const recs = await recommendationService.getRecommendations(client);
      const electiveItem = recs.allRecommendations.find((c) => c.code === 'XXX 001');
      expect(electiveItem.feedback).toBe(false);
      // Elective must be excluded from primary recommended set
      expect(recs.recommendedSet.map((c) => c.code)).not.toContain('XXX 001');

      getCurriculumSpy.mockRestore();
      evaluateSpy.mockRestore();
    });

    it('Scenario 2: Marking a mandatory course as not interesting keeps the course and returns warning', async () => {
      const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
      const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
        courses: {
          'CSS 105': { eligible: true },
          'XXX 001': { eligible: true },
        },
      });

      const client = { localUsername: 'test_student_fb_2' };

      // Submit dislike on mandatory course
      const feedbackRes = await recommendationService.submitFeedback(client, {
        courseCode: 'CSS 105',
        isInterested: false,
      });

      expect(feedbackRes.success).toBe(true);
      expect(feedbackRes.isMandatory).toBe(true);
      expect(feedbackRes.canHide).toBe(false);
      expect(feedbackRes.message).toBe('Mandatory courses cannot be hidden');

      // Verify course is kept in the recommended set
      const recs = await recommendationService.getRecommendations(client);
      const mandatoryItem = recs.recommendedSet.find((c) => c.code === 'CSS 105');
      expect(mandatoryItem).toBeDefined();
      expect(mandatoryItem.isMandatory).toBe(true);

      getCurriculumSpy.mockRestore();
      evaluateSpy.mockRestore();
    });

    it('Constraint: Feedback of one student does not affect recommendations of another student', async () => {
      const getCurriculumSpy = vi.spyOn(scheduleService, 'getCurriculum').mockResolvedValue(mockCurriculum);
      const evaluateSpy = vi.spyOn(prerequisiteService, 'evaluateCurriculum').mockResolvedValue({
        courses: {
          'CSS 105': { eligible: true },
          'XXX 001': { eligible: true },
        },
      });

      const clientA = { localUsername: 'test_student_fb_a' };
      const clientB = { localUsername: 'test_student_fb_b' };

      // Student A marks elective as not interesting
      await recommendationService.submitFeedback(clientA, {
        courseCode: 'XXX 001',
        isInterested: false,
      });

      // Student B should have clean recommendations without Student A's feedback
      const recsB = await recommendationService.getRecommendations(clientB);
      const electiveForB = recsB.allRecommendations.find((c) => c.code === 'XXX 001');
      expect(electiveForB.feedback).toBeNull();
      expect(recsB.recommendedSet.map((c) => c.code)).toContain('XXX 001');

      getCurriculumSpy.mockRestore();
      evaluateSpy.mockRestore();
    });
  });
});
