import { scheduleService } from './schedule.service.mjs';
import { prerequisiteService } from './prerequisite.service.mjs';
import { prerequisiteRepository } from '../repositories/prerequisite.repository.mjs';
import { recommendationRepository } from '../repositories/recommendation.repository.mjs';
import { recommendationConfigRepository } from '../repositories/recommendation-config.repository.mjs';
import { curriculumRepository } from '../repositories/curriculum.repository.mjs';
import { planRepository } from '../repositories/plan.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class PlanService {
  /**
   * Generates an optimal personalized semester study plan (US17).
   * Prioritizes failed courses (retakes) and current-semester mandatory courses up to the ECTS limit.
   */
  async generatePersonalizedPlan(client, { targetSemester = null, maxEcts = null } = {}) {
    const username = client?.localUsername;

    // Parallel fetch of curriculum, configuration, feedback, and prerequisite rules
    const [sduCurriculum, config, assignedList, userFeedback, prereqRules] = await Promise.all([
      scheduleService.getCurriculum(client),
      recommendationConfigRepository.getActiveConfig().catch(() => null),
      username ? curriculumRepository.listAssignedCurriculumsForUser(username).catch(() => []) : [],
      username ? recommendationRepository.getUserFeedback(username).catch(() => ({})) : {},
      prerequisiteRepository.getAllPrerequisites().catch(() => null),
    ]);

    let activeCurriculum = sduCurriculum;
    if (username && assignedList && assignedList.length > 0) {
      const activeCustom = assignedList.find((c) => c.is_active) || assignedList[0];
      if (activeCustom?.curriculum) {
        activeCurriculum = activeCustom.curriculum;
      }
    }

    const allCourses = activeCurriculum?.semesters?.flatMap((s) =>
      s.courses.map((c) => ({ ...c, semesterNo: s.no }))
    ) || [];

    // 1. Analyze student progress & find failed courses (retakes)
    const passedSet = new Set();
    const failedSet = new Set();

    for (const c of allCourses) {
      const code = c.code ? c.code.toUpperCase().trim() : '';
      if (!code) continue;

      const grade = c.grade ? c.grade.toUpperCase().trim() : null;
      const isPassed = c.status === 'passed' || (grade && grade !== 'F' && grade !== 'FX' && grade !== 'I' && grade !== 'NA');
      const isFailed = c.status === 'failed' || grade === 'F' || grade === 'FX';

      if (isPassed) {
        passedSet.add(code);
      } else if (isFailed) {
        failedSet.add(code);
      }
    }

    // Unmark failed courses that were subsequently retaken and passed
    for (const p of passedSet) {
      failedSet.delete(p);
    }

    // 2. Determine target next semester
    let targetSem = targetSemester ? parseInt(targetSemester, 10) : null;
    if (!targetSem) {
      targetSem = 1;
      for (const sem of (activeCurriculum?.semesters || [])) {
        const hasIncomplete = sem.courses.some((c) => {
          const code = c.code ? c.code.toUpperCase().trim() : '';
          return code && !passedSet.has(code);
        });
        if (hasIncomplete) {
          targetSem = sem.no;
          break;
        }
      }
    }

    // 3. Evaluate prerequisites for all courses
    const eligibilityResult = await prerequisiteService.evaluateCurriculum(activeCurriculum, prereqRules);
    const eligibilityMap = eligibilityResult.courses || {};

    // 4. ECTS Limits from active policy (US20)
    const minEctsLimit = Number(config?.min_ects) || 20;
    const maxEctsLimit = maxEcts ? Number(maxEcts) : (Number(config?.max_ects) || 21);

    // 5. Build candidate pools honoring US17 priority:
    // Retakes (Priority 1) -> Mandatory for targetSem (Priority 2) -> Overdue Mandatory (Priority 3) -> Electives/Optional
    const retakeCandidates = [];
    const currentMandatoryCandidates = [];
    const overdueMandatoryCandidates = [];
    const optionalCandidates = [];

    for (const c of allCourses) {
      const code = c.code ? c.code.toUpperCase().trim() : '';
      if (!code || passedSet.has(code)) continue;

      const isEligible = eligibilityMap[code]?.eligible === true;
      if (!isEligible) continue;

      const isRetake = failedSet.has(code);
      const isElective = c.isElective || /^XXX/i.test(code) || c.type === 'Elective';
      const isMandatory = !isElective;
      const semNo = c.semesterNo || targetSem;
      const cEcts = Number(c.ects) || 5;

      const courseCandidate = {
        code: c.code,
        name: c.name,
        ects: cEcts,
        credits: Number(c.credits) || 3,
        semester: semNo,
        isMandatory,
        isRetake,
        sectionsParams: c.sectionsParams || null,
        elective: c.elective || null,
      };

      if (isRetake) {
        retakeCandidates.push({
          ...courseCandidate,
          priority: 1200,
          reason: 'Failed course retake — highest academic priority',
        });
      } else if (isMandatory && semNo === targetSem) {
        currentMandatoryCandidates.push({
          ...courseCandidate,
          priority: 850,
          reason: `Required core curriculum course for Semester ${semNo}`,
        });
      } else if (isMandatory && semNo < targetSem) {
        overdueMandatoryCandidates.push({
          ...courseCandidate,
          priority: 800,
          reason: `Overdue mandatory course from Semester ${semNo}`,
        });
      } else {
        // Electives or advanced mandatory
        const isLiked = userFeedback[c.code] === true;
        const isDisliked = userFeedback[c.code] === false;
        let priority = 450;
        if (isLiked) priority += 250;
        if (isDisliked && !isMandatory) priority -= 300;

        optionalCandidates.push({
          ...courseCandidate,
          priority,
          reason: isMandatory
            ? `Advanced mandatory course for Semester ${semNo}`
            : isLiked
            ? 'Recommended elective aligned with student interests'
            : 'Eligible elective matching curriculum requirements',
        });
      }
    }

    // Sort optional candidates by priority descending
    optionalCandidates.sort((a, b) => b.priority - a.priority || a.semester - b.semester);

    // 6. Assemble the plan within ECTS limit (greedy packing)
    const planCourses = [];
    const addedCodes = new Set();
    let accEcts = 0;

    const getCourseUniqueKey = (c) => {
      const code = (c.code || '').toUpperCase().trim();
      const name = (c.name || '').toUpperCase().trim();
      if (/^XXX/i.test(code)) {
        return `${code}:${name}`;
      }
      return code;
    };

    const tryAddCourse = (cand) => {
      const key = getCourseUniqueKey(cand);
      if (addedCodes.has(key)) return false;
      const cEcts = Number(cand.ects) || 5;

      // Always allow adding if plan is empty or if within maxEctsLimit
      if (accEcts + cEcts <= maxEctsLimit || planCourses.length === 0) {
        planCourses.push(cand);
        addedCodes.add(key);
        accEcts += cEcts;
        return true;
      }
      return false;
    };

    // Step A: Priority 1 - All failed retakes
    for (const r of retakeCandidates) {
      tryAddCourse(r);
    }

    // Step B: Priority 2 - Current semester mandatory courses
    for (const m of currentMandatoryCandidates) {
      tryAddCourse(m);
    }

    // Step C: Priority 3 - Overdue mandatory courses
    for (const om of overdueMandatoryCandidates) {
      tryAddCourse(om);
    }

    // Step D: Priority 4 - Optional recommendations / electives up to maxEctsLimit
    for (const opt of optionalCandidates) {
      if (accEcts >= maxEctsLimit) break;
      tryAddCourse(opt);
    }

    // Categorization counts
    const retakesCount = planCourses.filter((c) => c.isRetake).length;
    const mandatoryCount = planCourses.filter((c) => c.isMandatory && !c.isRetake).length;
    const electivesCount = planCourses.filter((c) => !c.isMandatory).length;

    return {
      success: true,
      targetSemester: targetSem,
      minEctsLimit,
      maxEctsLimit,
      totalEcts: accEcts,
      isWithinLimit: accEcts >= minEctsLimit && accEcts <= maxEctsLimit,
      isOverLimit: accEcts > maxEctsLimit,
      courses: planCourses,
      counts: {
        total: planCourses.length,
        retakes: retakesCount,
        mandatory: mandatoryCount,
        electives: electivesCount,
      },
    };
  }

  /**
   * Saves an approved study plan to the database (US17).
   */
  async saveApprovedPlan(client, { targetSemester, courses, totalEcts }) {
    const username = client?.localUsername;
    if (!username) throw HttpError.unauthorized('User not authenticated');
    if (!targetSemester) throw HttpError.badRequest('targetSemester is required');
    if (!Array.isArray(courses)) throw HttpError.badRequest('courses array is required');

    const calculatedEcts = totalEcts ? Number(totalEcts) : courses.reduce((sum, c) => sum + (Number(c.ects) || 5), 0);

    const saved = await planRepository.savePlan(username, targetSemester, courses, calculatedEcts, true);
    return {
      success: true,
      message: 'Personalized study plan approved and saved successfully',
      plan: saved,
    };
  }

  /**
   * Retrieves student's approved study plan.
   */
  async getApprovedPlan(client, targetSemester = null) {
    const username = client?.localUsername;
    if (!username) throw HttpError.unauthorized('User not authenticated');
    const plan = await planRepository.getPlan(username, targetSemester);
    return {
      success: true,
      plan,
    };
  }
}

export const planService = new PlanService();
