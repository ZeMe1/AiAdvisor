/**
 * Shared utility for calculating a student's active current semester and target registration semester.
 * Employs the official SDU academic formula (term vs admission year) and in-progress course distribution,
 * matching the logic on the Curriculum Roadmap.
 */
export function calculateStudentSemesters({
  activeCurriculum,
  studentTerm = null,
  studentCourses = [],
  passedSet = new Set(),
}) {
  const semesters = activeCurriculum?.semesters || [];

  // 1. Count courses in progress by semester (taken / IP)
  const inProgressCountBySem = {};
  for (const sem of semesters) {
    for (const c of (sem.courses || [])) {
      const status = c.status || '';
      const grade = c.grade || '';
      if (status === 'taken' || grade === 'IP') {
        inProgressCountBySem[sem.no] = (inProgressCountBySem[sem.no] || 0) + 1;
      }
    }
  }

  if (Array.isArray(studentCourses) && studentCourses.length > 0) {
    for (const sc of studentCourses) {
      if (sc.status === 'taken' || sc.grade === 'IP' || sc.status === 'First time' || sc.status === 'Retake') {
        const semNo = sc.semester || sc.semesterNo;
        if (semNo) {
          inProgressCountBySem[semNo] = (inProgressCountBySem[semNo] || 0) + 1;
        }
      }
    }
  }

  // 2. Official SDU formula from current term (e.g. "2026 - 2027 Fall") and program admission year (e.g. 2024)
  const termMatch = (studentTerm || '').match(/(\d{4})\s*-\s*(\d{4})\s+(Fall|Spring|Summer)/i);
  const progYear = Number(activeCurriculum?.program?.year);
  let officialSem = null;
  if (termMatch && progYear && progYear > 2000) {
    const termYear = parseInt(termMatch[1], 10);
    const isSpring = /spring/i.test(termMatch[3]);
    const diff = termYear - progYear;
    if (diff >= 0 && diff <= 6) {
      officialSem = diff * 2 + (isSpring ? 2 : 1);
    }
  }

  // 3. Semester with most in-progress courses
  let maxInProgressCount = 0;
  let mostInProgressSem = null;
  for (const [sNoStr, count] of Object.entries(inProgressCountBySem)) {
    const sNo = Number(sNoStr);
    if (count > maxInProgressCount) {
      maxInProgressCount = count;
      mostInProgressSem = sNo;
    }
  }

  let currentSem = 1;
  if (mostInProgressSem && maxInProgressCount > 0) {
    if (officialSem && inProgressCountBySem[officialSem] === maxInProgressCount) {
      currentSem = officialSem;
    } else {
      currentSem = mostInProgressSem;
    }
  } else if (officialSem && semesters.some((s) => s.no === officialSem)) {
    currentSem = officialSem;
  } else {
    // Fallback: first semester that has incomplete courses
    const firstIncomplete = semesters.find((s) =>
      s.courses.some((c) => {
        const code = (c.code || '').toUpperCase().trim();
        return code && !passedSet.has(code);
      })
    );
    if (firstIncomplete) currentSem = firstIncomplete.no;
  }

  // 4. Target registration semester:
  // Matches the official calculated current semester from Roadmap
  const maxSemInCurriculum = semesters.length > 0 ? Math.max(...semesters.map((s) => s.no)) : 8;
  const isCurrentlyEnrolled = (inProgressCountBySem[currentSem] || 0) >= 2;
  const targetNextSem = isCurrentlyEnrolled
    ? Math.min(currentSem + 1, maxSemInCurriculum)
    : currentSem;

  return {
    currentSemester: currentSem,
    targetSemester: currentSem, // Matches Roadmap's calculated semester (Semester 5 for Kamila)
    nextSemester: targetNextSem,
    officialSemester: officialSem,
    mostInProgressSemester: mostInProgressSem,
    isCurrentlyEnrolled,
  };
}
