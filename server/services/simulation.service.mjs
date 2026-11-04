import { scheduleService } from './schedule.service.mjs';
import { prerequisiteService } from './prerequisite.service.mjs';
import { prerequisiteRepository } from '../repositories/prerequisite.repository.mjs';
import { recommendationConfigRepository } from '../repositories/recommendation-config.repository.mjs';
import { curriculumRepository } from '../repositories/curriculum.repository.mjs';

/**
 * Advances an academic term string (e.g. "2026 - 2027 Fall") by a given number of semesters.
 */
export function advanceTerm(currentTerm, semestersCount) {
  if (!currentTerm || typeof currentTerm !== 'string') {
    return 'Projected Term';
  }
  const match = currentTerm.match(/(\d{4})\s*-\s*(\d{4})\s+(Fall|Spring|Summer)/i);
  if (!match) return currentTerm;

  let startYear = parseInt(match[1], 10);
  let endYear = parseInt(match[2], 10);
  let season = match[3].toLowerCase();

  for (let i = 0; i < semestersCount; i++) {
    if (season === 'fall') {
      season = 'spring';
    } else {
      season = 'fall';
      startYear += 1;
      endYear += 1;
    }
  }

  const seasonFormatted = season.charAt(0).toUpperCase() + season.slice(1);
  return `${startYear} - ${endYear} ${seasonFormatted}`;
}

/**
 * Calculates the academic overload risk level based on chosen ECTS load and GPA history.
 * Explicitly complies with QA acceptance criteria:
 * - 12 ECTS: triggers 'Medium overload risk' (delay in graduation & sub-standard pace)
 * - >= 30 ECTS with GPA < 3.0: triggers 'High overload risk'
 * - 20-25 ECTS: triggers 'Low risk'
 */
export function calculateOverloadRisk(targetEcts, gpa) {
  const gpaNum = parseFloat(gpa) || 3.0;

  // QA Scenario 1: Light-load simulation (12 ECTS) produces 'Medium overload risk'
  if (targetEcts <= 15) {
    return {
      riskLevel: 'Medium',
      riskWarning: 'Medium overload risk',
      riskCode: 'BELOW_MIN_LOAD',
      description: 'Course load is significantly below the standard 20 ECTS threshold. Risk of delayed graduation and academic pace stagnation.',
      color: '#d97706', // Amber warning
    };
  }

  if (targetEcts >= 30) {
    if (gpaNum < 3.0) {
      return {
        riskLevel: 'High',
        riskWarning: 'High overload risk',
        riskCode: 'EXTREME_LOAD',
        description: 'Excessive credit load (>30 ECTS) with GPA below 3.0. High risk of course failure, GPA reduction, and burnout.',
        color: '#dc2626', // Red danger
      };
    }
    return {
      riskLevel: 'Medium',
      riskWarning: 'Medium overload risk',
      riskCode: 'HEAVY_LOAD',
      description: 'Challenging academic credit load requiring intensive weekly study commitment.',
      color: '#d97706',
    };
  }

  if (targetEcts > 25 && gpaNum < 2.5) {
    return {
      riskLevel: 'High',
      riskWarning: 'High overload risk',
      riskCode: 'GPA_LOAD_MISMATCH',
      description: 'Elevated credit load relative to academic standing (GPA < 2.5). Recommended safe load is 20-21 ECTS.',
      color: '#dc2626',
    };
  }

  return {
    riskLevel: 'Low',
    riskWarning: 'Low risk',
    riskCode: 'BALANCED_LOAD',
    description: 'Optimal and balanced academic pace matching standard university registration policy.',
    color: '#16a34a', // Green
  };
}

export class SimulationService {
  /**
   * Generates a non-persistent What-if simulation of academic progression.
   * Purely in-memory with zero side-effects on approved student plans or database.
   */
  async simulateWhatIf(client, { targetEctsPerSemester = 21, numSemesters = 2 } = {}) {
    const username = client?.localUsername;
    const targetEcts = Math.max(5, Math.min(60, Number(targetEctsPerSemester) || 21));
    const semestersToSimulate = Math.max(1, Math.min(8, Number(numSemesters) || 2));

    // Parallel fetch of curriculum, active config, and prerequisite rules
    const [sduCurriculum, config, assignedList, prereqRules] = await Promise.all([
      scheduleService.getCurriculum(client),
      recommendationConfigRepository.getActiveConfig().catch(() => null),
      username ? curriculumRepository.listAssignedCurriculumsForUser(username).catch(() => []) : [],
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

    // 1. Analyze student progress & GPA
    let completedEcts = 0;
    let totalQualityPoints = 0;
    let totalGpaEcts = 0;
    const passedSet = new Set();
    const failedSet = new Set();

    const GRADE_POINTS = {
      'A': 4.0, 'A-': 3.67,
      'B+': 3.33, 'B': 3.0, 'B-': 2.67,
      'C+': 2.33, 'C': 2.0, 'C-': 1.67,
      'D+': 1.33, 'D': 1.0,
      'F': 0.0, 'FX': 0.0,
    };

    for (const c of allCourses) {
      const code = c.code ? c.code.toUpperCase().trim() : '';
      if (!code) continue;

      const ects = Number(c.ects) || 5;
      const grade = c.grade ? c.grade.toUpperCase().trim() : null;
      const isPassed = c.status === 'passed' || (grade && grade !== 'F' && grade !== 'FX' && grade !== 'I' && grade !== 'NA');
      const isFailed = c.status === 'failed' || grade === 'F' || grade === 'FX';

      if (isPassed) {
        passedSet.add(code);
        completedEcts += ects;
        if (grade && GRADE_POINTS[grade] !== undefined) {
          totalQualityPoints += GRADE_POINTS[grade] * ects;
          totalGpaEcts += ects;
        }
      } else if (isFailed) {
        failedSet.add(code);
      }
    }

    for (const p of passedSet) {
      failedSet.delete(p);
    }

    const cumulativeGpa = totalGpaEcts > 0
      ? (totalQualityPoints / totalGpaEcts).toFixed(2)
      : '3.20';

    // 2. Compute total curriculum ECTS (standard bachelor = 240)
    let totalCurriculumEcts = 0;
    const seenCodes = new Set();
    for (const c of allCourses) {
      const code = c.code ? c.code.toUpperCase().trim() : '';
      if (code && !seenCodes.has(code)) {
        seenCodes.add(code);
        totalCurriculumEcts += Number(c.ects) || 5;
      }
    }
    if (totalCurriculumEcts < 120) {
      totalCurriculumEcts = 240; // Bachelor standard fallback
    }

    const remainingEcts = Math.max(0, totalCurriculumEcts - completedEcts);

    // 3. Current Academic Term & Starting Semester
    const currentTerm = client?.term || '2026 - 2027 Fall';
    let currentSemesterNo = 1;
    for (const sem of (activeCurriculum?.semesters || [])) {
      const hasIncomplete = sem.courses.some((c) => {
        const code = c.code ? c.code.toUpperCase().trim() : '';
        return code && !passedSet.has(code);
      });
      if (hasIncomplete) {
        currentSemesterNo = sem.no;
        break;
      }
    }

    // 4. Projected Graduation Calculation
    const baselineEcts = Number(config?.max_ects) || 21;
    const semestersNeeded = Math.ceil(remainingEcts / targetEcts);
    const baselineSemestersNeeded = Math.ceil(remainingEcts / baselineEcts);

    const projectedGraduationTerm = advanceTerm(currentTerm, semestersNeeded);
    const baselineGraduationTerm = advanceTerm(currentTerm, baselineSemestersNeeded);
    const delayInSemesters = semestersNeeded - baselineSemestersNeeded;

    // 5. Overload Risk Evaluation
    const riskAssessment = calculateOverloadRisk(targetEcts, cumulativeGpa);

    // 6. Simulate Next N Semesters in Sequence (Iterative chaining)
    const simulatedSemesters = [];
    let rollingPassed = new Set(passedSet);
    let rollingFailed = new Set(failedSet);

    for (let simIdx = 1; simIdx <= semestersToSimulate; simIdx++) {
      const semNumber = currentSemesterNo + (simIdx - 1);
      const semTerm = advanceTerm(currentTerm, simIdx);

      // Evaluate eligibility using rolling simulated passed set
      const simulatedCurriculum = {
        ...activeCurriculum,
        semesters: (activeCurriculum?.semesters || []).map((s) => ({
          ...s,
          courses: s.courses.map((c) => {
            const code = c.code ? c.code.toUpperCase().trim() : '';
            if (rollingPassed.has(code)) return { ...c, status: 'passed' };
            if (rollingFailed.has(code)) return { ...c, status: 'failed' };
            return { ...c, status: 'available' };
          }),
        })),
      };

      const eligibilityRes = await prerequisiteService.evaluateCurriculum(simulatedCurriculum, prereqRules);
      const eligibilityMap = eligibilityRes.courses || {};

      // Candidate pool for this semester
      const eligiblePool = [];
      for (const c of allCourses) {
        const code = c.code ? c.code.toUpperCase().trim() : '';
        if (!code || rollingPassed.has(code)) continue;

        const isEligible = eligibilityMap[code]?.eligible === true;
        if (!isEligible) continue;

        const isRetake = rollingFailed.has(code);
        const isElective = c.isElective || /^XXX/i.test(code) || c.type === 'Elective';
        const isMandatory = !isElective;
        const semNo = c.semesterNo || semNumber;

        // Scoring priority
        let priority = 400;
        if (isRetake) priority = 1200;
        else if (semNo === semNumber && isMandatory) priority = 800;
        else if (semNo < semNumber && isMandatory) priority = 850;
        else if (isMandatory) priority = 600;

        eligiblePool.push({
          code: c.code,
          name: c.name,
          ects: Number(c.ects) || 5,
          isMandatory,
          isRetake,
          semester: semNo,
          priority,
        });
      }

      // Sort by priority descending
      eligiblePool.sort((a, b) => b.priority - a.priority || a.semester - b.semester);

      // Greedily pack up to targetEcts
      const packedCourses = [];
      let accEcts = 0;
      for (const cand of eligiblePool) {
        if (packedCourses.some((p) => p.code === cand.code)) continue;
        if (accEcts + cand.ects <= targetEcts || packedCourses.length === 0) {
          packedCourses.push(cand);
          accEcts += cand.ects;
          rollingPassed.add(cand.code.toUpperCase().trim());
          rollingFailed.delete(cand.code.toUpperCase().trim());
        }
      }

      simulatedSemesters.push({
        semesterIndex: simIdx,
        semesterNumber: semNumber,
        termName: semTerm,
        targetEcts,
        totalEcts: accEcts,
        courseCount: packedCourses.length,
        courses: packedCourses,
      });
    }

    return {
      // US18 Constraints: Mandatory Simulation Watermark & Non-Persistence
      isSimulation: true,
      watermark: 'SIMULATION — NO CHANGES COMMITTED',
      simulationNotice: 'This is a sandbox simulation. Your real approved study plan remains completely unchanged.',
      timestamp: new Date().toISOString(),

      // Academic Overview
      currentTerm,
      currentSemester: currentSemesterNo,
      gpa: cumulativeGpa,
      totalCurriculumEcts,
      completedEcts,
      remainingEcts,

      // Simulation Parameters & Outcomes
      parameters: {
        targetEctsPerSemester: targetEcts,
        numSemestersSimulated: semestersToSimulate,
        baselineEctsPerSemester: baselineEcts,
      },
      projection: {
        targetEctsPerSemester: targetEcts,
        semestersNeeded,
        baselineSemestersNeeded,
        projectedGraduationTerm,
        baselineGraduationTerm,
        delayInSemesters,
        delayDescription: delayInSemesters > 0
          ? `+${delayInSemesters} semester${delayInSemesters > 1 ? 's' : ''} delayed graduation`
          : delayInSemesters < 0
          ? `${delayInSemesters} semester${Math.abs(delayInSemesters) > 1 ? 's' : ''} early graduation`
          : 'On track for standard graduation',
      },

      // Overload Risk Assessment
      risk: riskAssessment,

      // Detailed Simulation for next N semesters
      simulatedSemesters,
    };
  }
}

export const simulationService = new SimulationService();
