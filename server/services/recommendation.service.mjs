import { scheduleService } from './schedule.service.mjs';
import { prerequisiteService, GRADE_POINTS } from './prerequisite.service.mjs';
import { prerequisiteRepository } from '../repositories/prerequisite.repository.mjs';
import { curriculumService } from './curriculum.service.mjs';
import { recommendationRepository } from '../repositories/recommendation.repository.mjs';
import { recommendationConfigRepository } from '../repositories/recommendation-config.repository.mjs';
import { groupRepository } from '../repositories/group.repository.mjs';
import { curriculumRepository } from '../repositories/curriculum.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

/**
 * Normalizes academic program name by stripping leading/trailing years,
 * language designations (EN, KZ, RU), and punctuation.
 * e.g. "2024-Information Systems (EN)" -> "information systems"
 */
export function normalizeProgramName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/^\d{4}\s*[-/]\s*/, '') // Strip leading year: "2024-", "2024 / "
    .replace(/\s*[-/]\s*\d{4}$/, '') // Strip trailing year: " / 2024", "- 2024"
    .replace(/\s*\((EN|KZ|RU|KZ\/EN|EN\/KZ|TR)\)/gi, '') // Strip language tags: (EN), (KZ), (RU)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Checks whether candidate program string matches target program string
 * using normalized comparison and substring/containment rules.
 */
export function isProgramMatching(candidateProg, targetProg) {
  const c = normalizeProgramName(candidateProg);
  const t = normalizeProgramName(targetProg);
  if (!c || !t) return false;
  return c === t || c.includes(t) || t.includes(c);
}

/**
 * Generates a unique course identifier to disambiguate courses with identical placeholder
 * codes like 'XXX 4XX' (e.g. Elective 10 vs Elective 11) using elective metadata.
 */
export function getCourseIdentifier(c) {
  if (!c) return '';
  const code = (c.code || '').toUpperCase().trim();
  if (c.elective?.mufSqId) {
    return `${code}:${c.elective.mufSqId}`;
  }
  return code;
}

export class RecommendationService {
  /**
   * Generates personalized course recommendations based on completed courses, GPA, and curriculum.
   */
  async getRecommendations(client) {
    const username = client?.localUsername;

    // High performance: parallelize independent database & curriculum fetching
    const [
      sduCurriculum,
      config,
      groupInfo,
      assignedList,
      userFeedback,
      prereqRules,
    ] = await Promise.all([
      scheduleService.getCurriculum(client),
      recommendationConfigRepository.getActiveConfig(),
      username ? groupRepository.getStudentGroupAndAdvisor(username).catch(() => null) : null,
      username ? curriculumRepository.listAssignedCurriculumsForUser(username).catch(() => []) : [],
      username ? recommendationRepository.getUserFeedback(username).catch(() => ({})) : {},
      prerequisiteRepository.getAllPrerequisites().catch(() => null),
    ]);

    // Check if student has assigned curriculum or uses SDU
    const studentCompleted = sduCurriculum?.semesters?.flatMap((s) => s.courses) || [];
    let activeCurriculum = sduCurriculum;

    if (username && assignedList && assignedList.length > 0) {
      const activeCustom = assignedList.find((c) => c.is_active) || assignedList[0];
      if (activeCustom?.curriculum) {
        activeCurriculum = activeCustom.curriculum;
      }
    }

    const allCourses = activeCurriculum?.semesters?.flatMap((s) => s.courses.map((c) => ({ ...c, semesterNo: s.no }))) || [];

    // 0. Active recommendation engine configuration (US20)
    const minEctsLimit = Number(config?.min_ects) || 20;
    const maxEctsLimit = Number(config?.max_ects) || 21;

    // Multi-layer student academic program detection
    const candidatePrograms = [];

    // Layer 1: Enrolled student group (US13)
    if (groupInfo?.program) {
      candidatePrograms.push(groupInfo.program);
    }

    // Layer 2: Assigned administrator curriculum (US14)
    if (assignedList && assignedList.length > 0) {
      for (const curr of assignedList) {
        if (curr.program) candidatePrograms.push(curr.program);
      }
    }

    // Layer 3: Active curriculum program
    const activeProg = activeCurriculum?.program;
    if (typeof activeProg === 'string') {
      candidatePrograms.push(activeProg);
    } else if (activeProg && typeof activeProg === 'object') {
      if (activeProg.name) candidatePrograms.push(activeProg.name);
      if (activeProg.title) candidatePrograms.push(activeProg.title);
    }

    // Layer 4: SDU curriculum program
    const sduProg = sduCurriculum?.program;
    if (typeof sduProg === 'string') {
      candidatePrograms.push(sduProg);
    } else if (sduProg && typeof sduProg === 'object') {
      if (sduProg.name) candidatePrograms.push(sduProg.name);
      if (sduProg.title) candidatePrograms.push(sduProg.title);
    }

    // Pretty display name for student program
    let detectedProgramName = candidatePrograms.find((p) => typeof p === 'string' && p.trim().length > 0) || '';
    if (detectedProgramName) {
      detectedProgramName = detectedProgramName
        .replace(/^\d{4}\s*[-/]\s*/, '')
        .replace(/\s*[-/]\s*\d{4}$/, '')
        .replace(/\s*\((EN|KZ|RU|KZ\/EN|EN\/KZ|TR)\)/gi, '')
        .trim();
    } else {
      detectedProgramName = 'General Program';
    }

    const disabledProgramsList = config?.disabled_programs || [];
    const isProgramDisabled = disabledProgramsList.some((disProg) =>
      candidatePrograms.some((studentProg) => isProgramMatching(studentProg, disProg))
    );

    // 1. Calculate GPA from completed courses with valid grades (weighted by ECTS)
    let totalQualityPoints = 0;
    let totalGpaEcts = 0;
    let completedCredits = 0;
    const completedSet = new Set();
    const passedSet = new Set();
    const failedSet = new Set();

    for (const c of allCourses) {
      const code = c.code ? c.code.toUpperCase().trim() : '';
      if (!code) continue;

      const ects = Number(c.ects) || 5;
      const grade = c.grade ? c.grade.toUpperCase().trim() : null;
      const isPassed = c.status === 'passed' || (grade && grade !== 'F' && grade !== 'FX' && grade !== 'I' && grade !== 'NA');
      const isFailed = c.status === 'failed' || grade === 'F' || grade === 'FX';

      if (isPassed) {
        passedSet.add(code);
        completedSet.add(code);
        completedCredits += ects;
        if (grade && GRADE_POINTS[grade] !== undefined) {
          totalQualityPoints += GRADE_POINTS[grade] * ects;
          totalGpaEcts += ects;
        }
      } else if (isFailed) {
        failedSet.add(code);
      }
    }

    // Remove any failed courses that were subsequently passed
    for (const p of passedSet) {
      failedSet.delete(p);
    }

    const cumulativeGpa = totalGpaEcts > 0
      ? (totalQualityPoints / totalGpaEcts).toFixed(2)
      : '3.20'; // Default benchmark

    const gpaNum = parseFloat(cumulativeGpa);

    // 2. Determine target next semester
    // Find the lowest semester that still has incomplete courses
    let targetSemester = 1;
    for (const sem of (activeCurriculum?.semesters || [])) {
      const hasIncomplete = sem.courses.some((c) => {
        const code = c.code ? c.code.toUpperCase().trim() : '';
        return code && !passedSet.has(code);
      });
      if (hasIncomplete) {
        targetSemester = sem.no;
        break;
      }
    }

    // 3. Evaluate prerequisites for all courses using preloaded rules
    const eligibilityResult = await prerequisiteService.evaluateCurriculum(activeCurriculum, prereqRules);
    const eligibilityMap = eligibilityResult.courses || {};

    // 4. Rank candidate courses
    const candidateCourses = [];

    for (const c of allCourses) {
      const code = c.code ? c.code.toUpperCase().trim() : '';
      if (!code || passedSet.has(code)) continue;

      const el = eligibilityMap[code];
      const isEligible = el?.eligible === true;
      if (!isEligible) continue; // Only recommend eligible courses

      const isRetake = failedSet.has(code);
      const isElective = c.isElective || /^XXX/i.test(code) || c.type === 'Elective';
      const isMandatory = !isElective;
      const semNo = c.semesterNo || targetSemester;

      // Multipliers and weights from active configuration (US20)
      const retakeWeight = Number(config?.retake_weight) || 2.0;
      const interestWeight = Number(config?.interest_weight) || 1.5;
      const gpaWeight = Number(config?.gpa_weight) || 1.0;

      // Base scoring according to course status & curriculum position
      let baseScore = 400;
      let retakeBoost = 0;
      let gpaBoost = 0;
      let interestBoost = 0;
      let reason = '';

      const gpaRatio = Math.max(0, Math.min(1, gpaNum / 4.0));

      if (isRetake) {
        // Retakes prioritized highest (base 1200 multiplied by retake weight)
        baseScore = 1200;
        retakeBoost = Math.round(1000 * (retakeWeight - 1.0));
        reason = 'Previously failed course — retake prioritized to clear academic standing';
      } else if (semNo === targetSemester && isMandatory) {
        baseScore = 750;
        reason = `Required core curriculum course for Semester ${semNo}`;
        gpaBoost = Math.round(gpaRatio * 60 * gpaWeight);
      } else if (semNo < targetSemester && isMandatory) {
        baseScore = 850;
        reason = `Overdue mandatory course from Semester ${semNo} — prerequisites now fulfilled`;
        gpaBoost = Math.round(gpaRatio * 40 * gpaWeight);
      } else if (semNo > targetSemester && isMandatory) {
        baseScore = Math.max(350, 550 - (semNo - targetSemester) * 50);
        reason = `Advanced mandatory course for Semester ${semNo} — eligible ahead of schedule`;
        gpaBoost = Math.round(gpaRatio * 260 * gpaWeight);
      } else {
        // Elective course
        baseScore = 450;
        gpaBoost = Math.round(gpaRatio * 280 * gpaWeight);
        reason = gpaNum >= 3.0
          ? `Recommended elective for students in good academic standing (GPA ${cumulativeGpa})`
          : 'Eligible elective matching your program curriculum';
      }

      // Disambiguate placeholder codes like XXX 4XX using unique identifier
      const courseId = getCourseIdentifier(c);

      // Apply US19 feedback signal to score (lookup specific courseId first; only fallback to bare code if courseId === code)
      const feedbackVal = userFeedback[courseId] ?? (courseId === code ? userFeedback[code] : null) ?? null;
      if (feedbackVal === true) {
        // Liked / Interested: dynamic boost scaled by interest_weight
        interestBoost = Math.round(150 + 200 * interestWeight);
      } else if (feedbackVal === false) {
        // Disliked / Not interested
        if (!isMandatory) {
          interestBoost = -500;
        }
        // Mandatory courses cannot be downgraded or hidden (Constraint US19)
      }

      const totalScore = baseScore + retakeBoost + gpaBoost + interestBoost;

      candidateCourses.push({
        id: courseId,
        code: c.code,
        name: c.name,
        ects: Number(c.ects) || 5,
        credits: Number(c.credits) || 3,
        semester: semNo,
        isMandatory,
        isRetake,
        reason,
        score: totalScore,
        scoreBreakdown: {
          base: baseScore,
          retakeBoost,
          gpaBoost,
          interestBoost,
          total: totalScore,
        },
        feedback: feedbackVal,
        sectionsParams: c.sectionsParams || null,
        elective: c.elective || null,
      });
    }

    // Sort candidates: highest score first, then earliest semester
    candidateCourses.sort((a, b) => b.score - a.score || a.semester - b.semester);

    // 6. Select recommended set fitting within max ECTS limit (US16 / US20)
    let accumulatedEcts = 0;
    const recommendedSet = [];

    if (!isProgramDisabled) {
      for (const cand of candidateCourses) {
        // Disliked non-mandatory courses are excluded from primary recommended set if others are available
        if (cand.feedback === false && !cand.isMandatory) continue;

        if (accumulatedEcts + cand.ects <= maxEctsLimit) {
          recommendedSet.push(cand);
          accumulatedEcts += cand.ects;
        }
      }
    }

    // Mark items in candidateCourses that belong to recommendedSet using unique id
    const recSetIds = new Set(recommendedSet.map((r) => r.id || r.code));
    const allRecommendations = isProgramDisabled
      ? []
      : candidateCourses.map((c) => ({
          ...c,
          isRecommendedSet: recSetIds.has(c.id || c.code),
        }));

    return {
      gpa: cumulativeGpa,
      targetSemester,
      completedCredits,
      minEctsLimit,
      maxEctsLimit,
      recommendedEctsTotal: accumulatedEcts,
      recommendedSet,
      allRecommendations,
      isProgramDisabled: Boolean(isProgramDisabled),
      studentProgram: detectedProgramName,
      disabledReason: isProgramDisabled
        ? `Recommendations for ${detectedProgramName} have been disabled by university academic policy.`
        : null,
      activeWeights: {
        gpaWeight: Number(config?.gpa_weight) || 1.0,
        retakeWeight: Number(config?.retake_weight) || 2.0,
        interestWeight: Number(config?.interest_weight) || 1.5,
      },
    };
  }

  /**
   * Save student feedback on a recommended course (US19).
   */
  async submitFeedback(client, { courseCode, isInterested, targetSemester = null }) {
    const username = client?.localUsername;
    if (!username) throw HttpError.unauthorized('User not authenticated');
    if (!courseCode) throw HttpError.badRequest('courseCode is required');

    const cleanCode = courseCode.toUpperCase().trim();
    const bareCode = cleanCode.includes(':') ? cleanCode.split(':')[0].trim() : cleanCode;

    // If isInterested is null or explicitly undefined, delete feedback (toggle off)
    if (isInterested === null || isInterested === undefined) {
      await recommendationRepository.deleteFeedback(username, cleanCode);
      if (cleanCode.includes(':')) {
        await recommendationRepository.deleteFeedback(username, bareCode);
      }
      return {
        success: true,
        isMandatory: false,
        canHide: false,
        message: 'Feedback cleared for ' + cleanCode,
      };
    }

    // High performance: positive feedback can be saved immediately without loading heavy curriculum
    if (isInterested === true) {
      const saved = await recommendationRepository.saveFeedback(username, cleanCode, true, targetSemester);
      if (cleanCode.includes(':')) {
        await recommendationRepository.deleteFeedback(username, bareCode);
      }
      return {
        success: true,
        isMandatory: false,
        canHide: false,
        message: 'Course marked as interested',
        feedback: saved,
      };
    }

    // Check if course is mandatory in the student's curriculum
    const isPlaceholder = /XXX/i.test(bareCode);
    let isMandatory = false;

    if (!isPlaceholder) {
      const sduCurriculum = await scheduleService.getCurriculum(client);
      const allCourses = sduCurriculum?.semesters?.flatMap((s) => s.courses) || [];
      const courseObj = allCourses.find((c) =>
        (c.code && c.code.toUpperCase().trim() === bareCode) ||
        (getCourseIdentifier(c) === cleanCode)
      );

      const isElective = courseObj ? (courseObj.isElective || courseObj.type === 'Elective') : false;
      isMandatory = courseObj ? !isElective : false;
    }

    // Constraint US19 Scenario 2:
    // If student clicks "not interesting" on a mandatory course:
    // System keeps the course in the list and shows note 'Mandatory courses cannot be hidden'
    if (isInterested === false && isMandatory) {
      // Still log event for feedback/audit, but flag isMandatory = true
      await recommendationRepository.saveFeedback(username, cleanCode, isInterested, targetSemester);
      return {
        success: true,
        isMandatory: true,
        canHide: false,
        message: 'Mandatory courses cannot be hidden',
      };
    }

    // For electives or positive feedback
    if (cleanCode.includes(':')) {
      await recommendationRepository.deleteFeedback(username, bareCode);
    }
    const saved = await recommendationRepository.saveFeedback(username, cleanCode, isInterested, targetSemester);
    return {
      success: true,
      isMandatory: false,
      canHide: isInterested === false,
      message: isInterested ? 'Course marked as interested' : 'Course marked as not interesting and hidden',
      feedback: saved,
    };
  }

  // --- Recommendation Engine Configuration (US20) ---
  async getConfig() {
    const config = await recommendationConfigRepository.getActiveConfig();
    const history = await recommendationConfigRepository.getConfigHistory();
    return { config, history };
  }

  async updateConfig(data, adminUsername) {
    return recommendationConfigRepository.createConfig({
      ...data,
      created_by: adminUsername || 'Administrator',
    });
  }

  async resetConfig(adminUsername) {
    return recommendationConfigRepository.resetToDefault(adminUsername || 'Administrator');
  }
}

export const recommendationService = new RecommendationService();
