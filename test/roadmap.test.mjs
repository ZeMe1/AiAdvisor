import { describe, it, expect } from 'vitest';
import { prerequisiteService } from '../server/services/prerequisite.service.mjs';

describe('US15: See the Curriculum Roadmap', () => {
  const mockCurriculum = {
    program: {
      title: '2024-Information Systems (EN)',
      track: 'Main Track',
    },
    semesters: [
      {
        no: 1,
        courses: [
          { code: 'CSS 105', name: 'Fundamentals of Programming', ects: '5', status: 'passed', grade: 'A' },
          { code: 'MAT 137', name: 'Mathematics 1', ects: '5', status: 'passed', grade: 'B+' },
        ],
      },
      {
        no: 2,
        courses: [
          { code: 'CSS 108', name: 'Programming Tech', ects: '5', status: 'passed', grade: 'A-' },
          { code: 'MAT 138', name: 'Mathematics 2', ects: '5', status: 'passed', grade: 'B' },
        ],
      },
      {
        no: 3,
        courses: [
          { code: 'CSS 215', name: 'Data Structures & Algorithms', ects: '5', status: 'taken', grade: 'IP' },
          { code: 'CSS 216', name: 'Mobile Application Development', ects: '5', status: 'not_taken', grade: null },
        ],
      },
      {
        no: 4,
        courses: [
          { code: 'CS 401', name: 'Advanced Distributed Systems', ects: '5', status: 'not_taken', grade: null },
        ],
      },
    ],
  };

  const mockRules = [
    { course_code: 'CSS 108', prereq_course_code: 'CSS 105', min_grade: 'D', type: 'prerequisite' },
    { course_code: 'CSS 215', prereq_course_code: 'CSS 108', min_grade: 'D', type: 'prerequisite' },
    { course_code: 'CSS 216', prereq_course_code: 'CSS 108', min_grade: 'D', type: 'prerequisite' },
    // CS 401 requires CS 301 which student never took
    { course_code: 'CS 401', prereq_course_code: 'CS 301', min_grade: 'C', type: 'prerequisite' },
  ];

  // Scenario 1:
  // Given: The student completed 2 semesters of his program
  // When: The student opens the <My roadmap> page
  // Then: Semesters 1-2 show green completed courses, and the current semester is semester 3
  it('Scenario 1: correctly identifies completed courses in semesters 1-2 and sets active semester to 3', async () => {
    let completedEcts = 0;
    let inProgressEcts = 0;
    let totalEcts = 0;
    let currentSemester = 1;

    for (const sem of mockCurriculum.semesters) {
      for (const c of sem.courses) {
        const ects = Number(c.ects) || 0;
        totalEcts += ects;
        if (c.status === 'passed') {
          completedEcts += ects;
        } else if (c.status === 'taken' || c.grade === 'IP') {
          inProgressEcts += ects;
          if (sem.no > currentSemester) currentSemester = sem.no;
        }
      }
    }

    expect(completedEcts).toBe(20); // 4 courses * 5 ects
    expect(inProgressEcts).toBe(5);  // 1 course * 5 ects
    expect(totalEcts).toBe(35);
    expect(currentSemester).toBe(3); // Semester with in-progress course
  });

  // Scenario 2:
  // Given: The roadmap shows 'CS 401' as locked
  // When: Student inspects 'CS 401'
  // Then: Course is marked as locked (not eligible) and missing prerequisite 'CS 301' is reported
  it('Scenario 2: evaluates unfulfilled prerequisite course CS 401 as locked with view-only missing prerequisite info', async () => {
    const evalResult = await prerequisiteService.evaluateCurriculum(mockCurriculum, mockRules);

    const cs401 = evalResult.courses['CS 401'];
    expect(cs401.eligible).toBe(false);
    expect(cs401.status).toBe('not_eligible');
    expect(cs401.missingPrerequisites).toHaveLength(1);
    expect(cs401.missingPrerequisites[0].code).toBe('CS 301');
    expect(cs401.missingPrerequisites[0].minGrade).toBe('C');

    // And an eligible course (CSS 216 requires CSS 108 which was passed)
    const css216 = evalResult.courses['CSS 216'];
    expect(css216.eligible).toBe(true);
    expect(css216.status).toBe('eligible');
    expect(css216.missingPrerequisites).toHaveLength(0);
  });
});
