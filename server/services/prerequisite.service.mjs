import { prerequisiteRepository } from '../repositories/prerequisite.repository.mjs';

export const GRADE_POINTS = {
  'A': 4.0,
  'A-': 3.67,
  'B+': 3.33,
  'B': 3.0,
  'B-': 2.67,
  'C+': 2.33,
  'C': 2.0,
  'C-': 1.67,
  'D+': 1.33,
  'D': 1.0,
  'FX': 0.0,
  'F': 0.0,
  'I': 0.0,
  'NA': 0.0,
};

export function isGradeSatisfied(studentGrade, minGrade = 'D') {
  if (!studentGrade) return false;
  const sPts = GRADE_POINTS[studentGrade.toUpperCase().trim()];
  const reqPts = GRADE_POINTS[minGrade.toUpperCase().trim()] ?? 1.0;
  if (sPts === undefined) return false;
  return sPts >= reqPts;
}

export class PrerequisiteService {
  /**
   * Проверка доступности одного курса относительно списка пройденных предметов студента.
   * @param {string} courseCode
   * @param {Map<string, { status: string, grade: string|null }>} completedCoursesMap
   * @param {Array<{ prereq_course_code: string, min_grade: string, type: string }>} rules
   */
  checkCourseEligibility(courseCode, completedCoursesMap, rules = []) {
    const code = courseCode.toUpperCase().trim();
    const courseRules = rules.filter((r) => r.course_code?.toUpperCase().trim() === code || r.courseCode?.toUpperCase().trim() === code);

    if (courseRules.length === 0) {
      return {
        eligible: true,
        status: 'eligible',
        missingPrerequisites: [],
        reason: null,
      };
    }

    const missingPrerequisites = [];
    let hasCorequisiteInProgress = false;

    for (const rule of courseRules) {
      const prereqCode = (rule.prereq_course_code || rule.prereqCourseCode).toUpperCase().trim();
      const minGrade = (rule.min_grade || rule.minGrade || 'D').toUpperCase().trim();
      const isCoreq = (rule.type || 'prerequisite').toLowerCase() === 'corequisite';

      const studentCourse = completedCoursesMap.get(prereqCode);

      if (!studentCourse) {
        missingPrerequisites.push({
          code: prereqCode,
          minGrade,
          type: isCoreq ? 'corequisite' : 'prerequisite',
          reason: `Course ${prereqCode} is not completed`,
        });
        continue;
      }

      // Проверка пересдачи (retake): если студент пересдал курс и имеет статус passed
      const isPassedStatus = studentCourse.status === 'passed';
      const grade = studentCourse.grade ? studentCourse.grade.toUpperCase().trim() : null;

      if (studentCourse.status === 'failed' || grade === 'F' || grade === 'FX') {
        missingPrerequisites.push({
          code: prereqCode,
          minGrade,
          type: isCoreq ? 'corequisite' : 'prerequisite',
          reason: `Course ${prereqCode} was failed (Grade: ${grade || 'F'})`,
        });
        continue;
      }

      if (isCoreq && (studentCourse.status === 'taken' || grade === 'IP')) {
        hasCorequisiteInProgress = true;
        continue;
      }

      // Если есть конкретная оценка, проверяем соответствие минимальному баллу
      if (grade && !isGradeSatisfied(grade, minGrade)) {
        missingPrerequisites.push({
          code: prereqCode,
          minGrade,
          type: isCoreq ? 'corequisite' : 'prerequisite',
          reason: `Grade ${grade} in ${prereqCode} is below required minimum ${minGrade}`,
        });
        continue;
      }

      if (!isPassedStatus && grade !== 'IP' && (!grade || (GRADE_POINTS[grade] ?? 0) < (GRADE_POINTS[minGrade] ?? 1.0))) {
        missingPrerequisites.push({
          code: prereqCode,
          minGrade,
          type: isCoreq ? 'corequisite' : 'prerequisite',
          reason: `Course ${prereqCode} is not passed`,
        });
      }
    }

    if (missingPrerequisites.length > 0) {
      const missingNames = missingPrerequisites.map((m) => `${m.code} (min ${m.minGrade})`).join(', ');
      return {
        eligible: false,
        status: 'not_eligible',
        missingPrerequisites,
        reason: `Missing prerequisites: ${missingNames}`,
      };
    }

    if (hasCorequisiteInProgress) {
      return {
        eligible: true,
        status: 'corequisite',
        missingPrerequisites: [],
        reason: 'Eligible concurrently with corequisite course',
      };
    }

    return {
      eligible: true,
      status: 'eligible',
      missingPrerequisites: [],
      reason: null,
    };
  }

  /**
   * Оценка доступности для всего куррикулума студента.
   * Выполняется за O(N) в памяти (< 10 мс).
   */
  async evaluateCurriculum(curriculum, customRules = null) {
    const rules = customRules || (await prerequisiteRepository.getAllPrerequisites());

    const allCourses = curriculum?.semesters?.flatMap((s) => s.courses) ?? [];

    // Строим карту завершенных студентом предметов с учетом правила пересдач (retakes)
    const completedCoursesMap = new Map();
    for (const c of allCourses) {
      if (!c.code) continue;
      const codeKey = c.code.toUpperCase().trim();
      const existing = completedCoursesMap.get(codeKey);

      // Если курс сдан (passed) или имеет положительную оценку, он перекрывает старый неуспешный результат
      const isPassed = c.status === 'passed';
      const isPositiveGrade = c.grade && c.grade !== 'F' && c.grade !== 'FX';

      if (!existing) {
        completedCoursesMap.set(codeKey, c);
      } else if (isPassed || (existing.status !== 'passed' && isPositiveGrade)) {
        completedCoursesMap.set(codeKey, c);
      }
    }

    const coursesEligibility = {};
    let eligibleCount = 0;
    let notEligibleCount = 0;

    for (const c of allCourses) {
      if (!c.code) continue;
      const codeKey = c.code.toUpperCase().trim();
      const result = this.checkCourseEligibility(codeKey, completedCoursesMap, rules);
      coursesEligibility[codeKey] = {
        name: c.name,
        currentStatus: c.status,
        currentGrade: c.grade,
        ...result,
      };

      if (result.eligible) eligibleCount++;
      else notEligibleCount++;
    }

    return {
      summary: {
        totalEvaluated: allCourses.length,
        eligibleCount,
        notEligibleCount,
      },
      courses: coursesEligibility,
    };
  }
}

export const prerequisiteService = new PrerequisiteService();
