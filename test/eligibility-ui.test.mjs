import { describe, it, expect } from 'vitest';
import { prerequisiteService } from '../server/services/prerequisite.service.mjs';

describe('US12: Check Course Eligibility (Logic & Badges)', () => {
  // Scenario 1:
  // Given: Student is not eligible for 'CS 301'
  // When: Check 'CS 301'
  // Then: Shows 'not_eligible' and lists missing prerequisite 'CS 201'
  it('Scenario 1: identifies not eligible course and lists missing prerequisite with required min grade', () => {
    const studentCompleted = new Map([
      ['CS 101', { status: 'passed', grade: 'B' }],
    ]);

    const rules = [
      { course_code: 'CS 301', prereq_course_code: 'CS 201', min_grade: 'C', type: 'prerequisite' },
    ];

    const result = prerequisiteService.checkCourseEligibility('CS 301', studentCompleted, rules);
    expect(result.eligible).toBe(false);
    expect(result.status).toBe('not_eligible');
    expect(result.missingPrerequisites).toHaveLength(1);
    expect(result.missingPrerequisites[0].code).toBe('CS 201');
    expect(result.missingPrerequisites[0].minGrade).toBe('C');
  });

  // Scenario 2:
  // Given: Student sees not_eligible for 'CS 301'
  // When: Student completes 'CS 201' with passing grade
  // Then: Status changes to 'eligible'
  it('Scenario 2: updates status to eligible when missing course is completed with passing grade', () => {
    const studentCompleted = new Map([
      ['CS 101', { status: 'passed', grade: 'B' }],
      ['CS 201', { status: 'passed', grade: 'B+' }],
    ]);

    const rules = [
      { course_code: 'CS 301', prereq_course_code: 'CS 201', min_grade: 'C', type: 'prerequisite' },
    ];

    const result = prerequisiteService.checkCourseEligibility('CS 301', studentCompleted, rules);
    expect(result.eligible).toBe(true);
    expect(result.status).toBe('eligible');
    expect(result.missingPrerequisites).toHaveLength(0);
  });

  it('correctly reports corequisite courses in progress', () => {
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
});
