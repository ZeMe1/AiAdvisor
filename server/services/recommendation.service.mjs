import { scheduleService } from './schedule.service.mjs';
import { prerequisiteService, GRADE_POINTS } from './prerequisite.service.mjs';
import { curriculumService } from './curriculum.service.mjs';
import { recommendationRepository } from '../repositories/recommendation.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class RecommendationService {
  /**
   * Generates personalized course recommendations based on completed courses, GPA, and curriculum.
   */
  async getRecommendations(client) {
    const sduCurriculum = await scheduleService.getCurriculum(client);
    const username = client?.localUsername;

    // Check if student has assigned curriculum or uses SDU
    const studentCompleted = sduCurriculum?.semesters?.flatMap((s) => s.courses) || [];
    let activeCurriculum = sduCurriculum;

    if (username) {
      try {
        const roadmapData = await curriculumService.getRoadmapCurriculumsForStudent(username, studentCompleted, sduCurriculum);
        const assigned = roadmapData?.curriculums?.find((c) => !c.is_default);
        if (assigned) {
          activeCurriculum = assigned;
        }
      } catch (e) {
        console.warn('[recommendationService] Error loading custom curriculum, using SDU:', e.message);
      }
    }

    const allCourses = activeCurriculum?.semesters?.flatMap((s) => s.courses.map((c) => ({ ...c, semesterNo: s.no }))) || [];

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

    // 3. Evaluate prerequisites for all courses
    const eligibilityResult = await prerequisiteService.evaluateCurriculum(activeCurriculum);
    const eligibilityMap = eligibilityResult.courses || {};

    // 4. Fetch stored student feedback (US19: like / dislike)
    const userFeedback = username ? await recommendationRepository.getUserFeedback(username) : {};

    // 5. Rank candidate courses
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

      let score = 100;
      let reason = '';

      if (isRetake) {
        score = 1000;
        reason = 'Previously failed course — retake prioritized to clear academic standing';
      } else if (semNo === targetSemester && isMandatory) {
        score = 800;
        reason = `Required core curriculum course for Semester ${semNo}`;
      } else if (semNo < targetSemester && isMandatory) {
        score = 850;
        reason = `Overdue mandatory course from Semester ${semNo} — prerequisites now fulfilled`;
      } else if (semNo > targetSemester && isMandatory) {
        score = 500 - (semNo - targetSemester) * 50;
        reason = `Advanced mandatory course for Semester ${semNo} — eligible ahead of schedule`;
      } else {
        // Elective
        score = 400 + (gpaNum >= 3.0 ? 50 : 0);
        reason = gpaNum >= 3.0
          ? `Recommended elective for students in good academic standing (GPA ${cumulativeGpa})`
          : 'Eligible elective matching your program curriculum';
      }

      // Apply US19 feedback signal to score
      const feedbackVal = userFeedback[code] ?? null;
      if (feedbackVal === true) {
        // Liked / Interested: boost score
        score += 200;
      } else if (feedbackVal === false) {
        // Disliked / Not interested
        if (!isMandatory) {
          // Downgrade non-mandatory course so it's ranked lower in next generation
          score -= 500;
        }
        // Mandatory courses cannot be downgraded or hidden (Constraint US19)
      }

      candidateCourses.push({
        code: c.code,
        name: c.name,
        ects: Number(c.ects) || 5,
        credits: Number(c.credits) || 3,
        semester: semNo,
        isMandatory,
        isRetake,
        reason,
        score,
        feedback: feedbackVal,
        sectionsParams: c.sectionsParams || null,
        elective: c.elective || null,
      });
    }

    // Sort candidates: highest score first, then earliest semester
    candidateCourses.sort((a, b) => b.score - a.score || a.semester - b.semester);

    // 6. Select recommended set fitting within max 21 ECTS (Scenario 2)
    const maxEctsLimit = 21;
    let accumulatedEcts = 0;
    const recommendedSet = [];

    for (const cand of candidateCourses) {
      // Disliked non-mandatory courses are excluded from primary recommended set if others are available
      if (cand.feedback === false && !cand.isMandatory) continue;

      if (accumulatedEcts + cand.ects <= maxEctsLimit) {
        recommendedSet.push(cand);
        accumulatedEcts += cand.ects;
      }
    }

    // Mark items in candidateCourses that belong to recommendedSet
    const recSetCodes = new Set(recommendedSet.map((r) => r.code));
    const allRecommendations = candidateCourses.map((c) => ({
      ...c,
      isRecommendedSet: recSetCodes.has(c.code),
    }));

    return {
      gpa: cumulativeGpa,
      targetSemester,
      completedCredits,
      maxEctsLimit,
      recommendedEctsTotal: accumulatedEcts,
      recommendedSet,
      allRecommendations,
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

    // Check if course is mandatory in the student's curriculum
    const sduCurriculum = await scheduleService.getCurriculum(client);
    const allCourses = sduCurriculum?.semesters?.flatMap((s) => s.courses) || [];
    const courseObj = allCourses.find((c) => c.code && c.code.toUpperCase().trim() === cleanCode);

    const isElective = courseObj ? (courseObj.isElective || /^XXX/i.test(cleanCode) || courseObj.type === 'Elective') : false;
    const isMandatory = courseObj ? !isElective : false;

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
    const saved = await recommendationRepository.saveFeedback(username, cleanCode, isInterested, targetSemester);
    return {
      success: true,
      isMandatory: false,
      canHide: isInterested === false,
      message: isInterested ? 'Course marked as interested' : 'Course marked as not interesting and hidden',
      feedback: saved,
    };
  }
}

export const recommendationService = new RecommendationService();
