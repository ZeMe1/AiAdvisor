import { describe, it, expect } from 'vitest';
import { prerequisiteService, isGradeSatisfied, GRADE_POINTS } from '../server/services/prerequisite.service.mjs';

describe('US11: Automatic Prerequisite Checking', () => {
  it('correctly maps and compares grade thresholds', () => {
    expect(GRADE_POINTS['A']).toBe(4.0);
    expect(GRADE_POINTS['B']).toBe(3.0);
    expect(GRADE_POINTS['C']).toBe(2.0);
    expect(GRADE_POINTS['D']).toBe(1.0);
    expect(GRADE_POINTS['F']).toBe(0.0);

    expect(isGradeSatisfied('B', 'C')).toBe(true);
    expect(isGradeSatisfied('C', 'C')).toBe(true);
    expect(isGradeSatisfied('C-', 'C')).toBe(false);
    expect(isGradeSatisfied('F', 'D')).toBe(false);
  });

  // Scenario 1 from Excel:
  // Given: Student completed 'CS 101' with grade B
  // When: Check 'CS 201' that requires 'CS 101' with min grade C
  // Then: Mark 'CS 201' as eligible
  it('Scenario 1: marks course as eligible when prerequisite grade is satisfied', () => {
    const studentCompleted = new Map([
      ['CS 101', { status: 'passed', grade: 'B' }],
    ]);

    const rules = [
      { course_code: 'CS 201', prereq_course_code: 'CS 101', min_grade: 'C', type: 'prerequisite' },
    ];

    const result = prerequisiteService.checkCourseEligibility('CS 201', studentCompleted, rules);
    expect(result.eligible).toBe(true);
    expect(result.status).toBe('eligible');
    expect(result.missingPrerequisites).toHaveLength(0);
  });

  // Scenario 2 from Excel:
  // Given: Student failed 'MATH 101' (grade F)
  // When: Check 'MATH 201' that requires 'MATH 101'
  // Then: Mark 'MATH 201' as not eligible and show 'MATH 101' in missing prerequisites
  it('Scenario 2: marks course as not eligible when prerequisite is failed (grade F)', () => {
    const studentCompleted = new Map([
      ['MATH 101', { status: 'failed', grade: 'F' }],
    ]);

    const rules = [
      { course_code: 'MATH 201', prereq_course_code: 'MATH 101', min_grade: 'D', type: 'prerequisite' },
    ];

    const result = prerequisiteService.checkCourseEligibility('MATH 201', studentCompleted, rules);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('not_eligible');
    expect(result.missingPrerequisites).toHaveLength(1);
    expect(result.missingPrerequisites[0].code).toBe('MATH 101');
    expect(result.reason).toContain('MATH 101');
  });

  it('marks course as not eligible when prerequisite course has never been taken', () => {
    const studentCompleted = new Map();
    const rules = [
      { course_code: 'CS 201', prereq_course_code: 'CS 101', min_grade: 'C', type: 'prerequisite' },
    ];

    const result = prerequisiteService.checkCourseEligibility('CS 201', studentCompleted, rules);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('not_eligible');
    expect(result.missingPrerequisites[0].code).toBe('CS 101');
  });

  it('retake rule: replaces previous failing grade with subsequent passing grade', async () => {
    // Student initially took MATH 101 in sem 1 and failed (F), then retook in sem 2 and passed (B)
    const mockCurriculum = {
      semesters: [
        {
          no: 1,
          courses: [
            { code: 'MATH 101', status: 'failed', grade: 'F' },
          ],
        },
        {
          no: 2,
          courses: [
            { code: 'MATH 101', status: 'passed', grade: 'B' },
            { code: 'MATH 201', status: 'not_taken', grade: null },
          ],
        },
      ],
    };

    const customRules = [
      { course_code: 'MATH 201', prereq_course_code: 'MATH 101', min_grade: 'D', type: 'prerequisite' },
    ];

    const evalResult = await prerequisiteService.evaluateCurriculum(mockCurriculum, customRules);
    expect(evalResult.courses['MATH 201'].eligible).toBe(true);
    expect(evalResult.courses['MATH 201'].status).toBe('eligible');
  });

  it('handles corequisite links when prerequisite is currently in progress', () => {
    const studentCompleted = new Map([
      ['PHY 101', { status: 'taken', grade: 'IP' }],
    ]);

    const rules = [
      { course_code: 'PHY 102', prereq_course_code: 'PHY 101', min_grade: 'D', type: 'corequisite' },
    ];

    const result = prerequisiteService.checkCourseEligibility('PHY 102', studentCompleted, rules);
    expect(result.eligible).toBe(true);
    expect(result.status).toBe('corequisite');
  });

  it('performance check: evaluates entire curriculum for student in well under 3 seconds', async () => {
    const mockCourses = [];
    for (let i = 1; i <= 50; i++) {
      mockCourses.push({
        code: `COURSE ${i}`,
        status: i <= 20 ? 'passed' : 'not_taken',
        grade: i <= 20 ? 'A' : null,
      });
    }

    const mockCurriculum = {
      semesters: [
        { no: 1, courses: mockCourses.slice(0, 25) },
        { no: 2, courses: mockCourses.slice(25, 50) },
      ],
    };

    const rules = [];
    for (let i = 2; i <= 50; i++) {
      rules.push({
        course_code: `COURSE ${i}`,
        prereq_course_code: `COURSE ${i - 1}`,
        min_grade: 'C',
        type: 'prerequisite',
      });
    }

    const start = performance.now();
    const evalResult = await prerequisiteService.evaluateCurriculum(mockCurriculum, rules);
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(3000); // Spec SLA is < 3000ms
    expect(evalResult.summary.totalEvaluated).toBe(50);
    // Courses 1-20 are passed; COURSE 21 requires COURSE 20 which is passed -> eligible!
    expect(evalResult.courses['COURSE 21'].eligible).toBe(true);
    // COURSE 22 requires COURSE 21 which is not passed -> not eligible!
    expect(evalResult.courses['COURSE 22'].eligible).toBe(false);
  });
});
