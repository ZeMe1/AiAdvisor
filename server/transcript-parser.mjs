import xlsx from 'xlsx';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

/**
 * Official university letter grade conversion to 4.0 scale (matching SDU scale).
 */
export const GRADE_SCALE = {
  'A': 4.00,
  'A-': 3.67,
  'B+': 3.33,
  'B': 3.00,
  'B-': 2.67,
  'C+': 2.33,
  'C': 2.00,
  'C-': 1.67,
  'D+': 1.33,
  'D': 1.00,
  'F': 0.00,
  'FX': 0.00,
  'P': 0.00,
  'NP': 0.00,
  'IP': 0.00,
};

/**
 * Normalize raw grade string or percentage to letter grade & GPA points
 */
export function normalizeGrade(raw) {
  if (raw == null) return { grade: 'P', gpa: 0, isPassing: true, isCompleted: true };
  const s = String(raw).trim().toUpperCase();

  if (s === 'IP') {
    return { grade: 'IP', gpa: 0, isPassing: false, isCompleted: false };
  }

  if (GRADE_SCALE[s] !== undefined) {
    return {
      grade: s,
      gpa: GRADE_SCALE[s],
      isPassing: s === 'P' || GRADE_SCALE[s] >= 1.0,
      isCompleted: s !== 'IP'
    };
  }

  // Check if numeric (0-100)
  const num = parseFloat(s);
  if (!isNaN(num)) {
    if (num >= 95) return { grade: 'A', gpa: 4.00, isPassing: true, isCompleted: true };
    if (num >= 90) return { grade: 'A-', gpa: 3.67, isPassing: true, isCompleted: true };
    if (num >= 85) return { grade: 'B+', gpa: 3.33, isPassing: true, isCompleted: true };
    if (num >= 80) return { grade: 'B', gpa: 3.00, isPassing: true, isCompleted: true };
    if (num >= 75) return { grade: 'B-', gpa: 2.67, isPassing: true, isCompleted: true };
    if (num >= 70) return { grade: 'C+', gpa: 2.33, isPassing: true, isCompleted: true };
    if (num >= 65) return { grade: 'C', gpa: 2.00, isPassing: true, isCompleted: true };
    if (num >= 60) return { grade: 'C-', gpa: 1.67, isPassing: true, isCompleted: true };
    if (num >= 55) return { grade: 'D+', gpa: 1.33, isPassing: true, isCompleted: true };
    if (num >= 50) return { grade: 'D', gpa: 1.00, isPassing: true, isCompleted: true };
    return { grade: 'F', gpa: 0.00, isPassing: false, isCompleted: true };
  }

  if (s === 'PASS') return { grade: 'P', gpa: 0, isPassing: true, isCompleted: true };
  if (s === 'FAIL') return { grade: 'F', gpa: 0, isPassing: false, isCompleted: true };

  return { grade: s, gpa: 0, isPassing: true, isCompleted: true };
}

/**
 * Normalizes course code to "PREFIX NUMBER", e.g. "CSS108" -> "CSS 108"
 */
export function normalizeCourseCode(raw) {
  if (!raw) return '';
  const match = String(raw).trim().match(/^([A-Za-z]{2,5})\s*[-_]?\s*(\d{3,4}[A-Za-z]?)$/);
  if (match) {
    return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
  }
  return String(raw).trim().toUpperCase();
}

/**
 * Match parsed course with catalog
 */
function matchWithCatalog(course, catalogCourses = []) {
  const normCode = normalizeCourseCode(course.course_code);
  const found = catalogCourses.find(
    c => normalizeCourseCode(c.code) === normCode || normalizeCourseCode(c.course_code) === normCode
  );

  return {
    ...course,
    course_code: normCode,
    course_name: course.course_name || (found ? found.name : normCode),
    credits: Number(course.credits) || (found ? Number(found.credits) : 5),
    matched: !!found || /^[A-Z]{2,4}\s+\d{3}$/.test(normCode)
  };
}

/**
 * Calculate GPA and total credits
 */
export function computeSummary(courses = []) {
  let totalGradePoints = 0;
  let gpaCredits = 0;
  let earnedCredits = 0;

  for (const c of courses) {
    const cred = Number(c.credits) || 0;
    const gpa = Number(c.gpa_points) || 0;
    const grade = (c.grade || '').toUpperCase();

    // IP (in progress), P, NP are excluded from GPA calculation (per SDU formula)
    if (grade !== 'P' && grade !== 'NP' && grade !== 'IP' && grade !== 'W' && grade !== 'I') {
      totalGradePoints += cred * gpa;
      gpaCredits += cred;
    }

    if (gpa >= 1.0 || grade === 'P') {
      earnedCredits += cred;
    }
  }

  const estimatedGpa = gpaCredits > 0 ? Number((totalGradePoints / gpaCredits).toFixed(2)) : 0.00;
  return {
    totalCredits: earnedCredits,
    gpaCredits,
    estimatedGpa
  };
}

/**
 * Parse SDU PDF transcript with column & line continuation logic
 */
export async function parsePdfBuffer(buffer, catalogCourses = [], authUser = {}) {
  let docText = '';
  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    if (result && Array.isArray(result.pages)) {
      docText = result.pages.map(p => p.text).join('\n');
    }
    await parser.destroy().catch(() => {});
  } catch (err) {
    throw new Error('Could not recognize the file: Invalid or corrupted PDF document.');
  }

  if (!docText || docText.trim().length < 20) {
    throw new Error('Could not recognize the file: PDF appears to be a scanned image without a text layer. Please enter courses manually.');
  }

  // Anti-Fake / Student ID & Name verification
  const idMatch = docText.match(/Student\s*(?:№|No|#)?\s*:\s*(\d{7,12})/i) || docText.match(/\bID\s*:\s*(\d{7,12})/i);
  const detectedStudentId = idMatch ? idMatch[1] : null;

  const nameMatch = docText.match(/Student\s*Name\s*:\s*([^\t\r\n]+)/i);
  const detectedStudentName = nameMatch ? nameMatch[1].trim() : null;

  if (!detectedStudentId) {
    const err = new Error(
      '⛔ Verification Error (Anti-Fake): Official Student ID (Student №) not found in the uploaded file. Please upload an official SDU transcript.'
    );
    err.status = 400;
    throw err;
  }

  const siteUsername = String(authUser.username || '').trim();
  if (!siteUsername) {
    const err = new Error(
      '⛔ Authorization Error: Could not determine your SDU Login (username). Please log in again.'
    );
    err.status = 401;
    throw err;
  }

  const fileStudentId = String(detectedStudentId).trim();
  const isOwner = fileStudentId === siteUsername;

  if (!isOwner) {
    const err = new Error(
      `⛔ Verification Error (Anti-Fake): ID in .pdf (${fileStudentId}) does not match your SDU Login on the website (${siteUsername}). Upload rejected!`
    );
    err.status = 400;
    throw err;
  }

  const lines = docText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const parsedCourses = [];
  let currentSemester = '';

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Semester Header: e.g. "2024 - 2025. 1"
    const semMatch = line.match(/^(\d{4})\s*-\s*(\d{4})\s*\.\s*([12])/);
    if (semMatch) {
      const year1 = semMatch[1];
      const year2 = semMatch[2];
      const termNum = semMatch[3];
      const termName = termNum === '1' ? `Fall ${year1}` : `Spring ${year2}`;
      currentSemester = `${termName} (${semMatch[0]})`;
      i++;
      continue;
    }

    // Skip footer summaries, metadata and table headers
    if (/^(SA\s*:|GA\s*:|SPA\s*:|GPA\s*:|Total Internal Credits|Total credits|Student №|Major program|faculty:|specialty:|date:|course code|grade|In Percent|Notes|Prepared Date)/i.test(line)) {
      i++;
      continue;
    }

    // Check if line starts with course code: e.g. CSS 105, INF 106, MDE 002
    const codeMatch = line.match(/^([A-Z]{2,4}\s+\d{3})\b/);
    if (codeMatch) {
      const courseCode = normalizeCourseCode(codeMatch[1]);
      let combined = line;

      // Handle multi-line course titles (wrapped across lines in PDF)
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        if (!nextLine.match(/^([A-Z]{2,4}\s+\d{3})\b/) &&
            !nextLine.match(/^(\d{4})\s*-\s*(\d{4})\s*\.\s*([12])/) &&
            !nextLine.match(/^(SA\s*:|GA\s*:|23\s+\d+|15\s+\d+|25\s+\d+|Total\s+)/i)) {
          if (nextLine.includes('\t') || nextLine.match(/\d+\s+(Good|Excellent|Satisfactory|Pass|In progress)/i)) {
            combined = `${line} ${nextLine}`;
            i++; // consumed next line
          }
        }
      }

      const rest = combined.slice(codeMatch[1].length).trim();
      let title = '';
      let credit = 3;
      let ects = 5;
      let letterGrade = 'P';
      let point = 0;

      const parts = rest.split('\t').map(p => p.trim()).filter(Boolean);

      if (parts.length >= 3) {
        title = parts[0];
        const p1 = parts[1];
        const p2 = parts[2];

        // Check if internal credit was glued to title before tab (e.g. "Technologies 3")
        const trailingCreditMatch = title.match(/^(.*?)\s+(\d+)$/);
        if (trailingCreditMatch && (Number(p2) > 10 || /^(P|NP|IP|[A-D][+-]?|F)$/i.test(p2))) {
          title = trailingCreditMatch[1];
          credit = Number(trailingCreditMatch[2]) || 3;
          ects = Number(p1) || 5;

          for (let pIdx = 2; pIdx < parts.length; pIdx++) {
            const pVal = parts[pIdx].replace(/\*/g, '').trim();
            if (/^([A-D][+-]?|F|FX|P|NP|IP)$/i.test(pVal)) {
              letterGrade = pVal.toUpperCase();
            } else if (/^\d+(\.\d+)?$/.test(pVal) && Number(pVal) <= 4.0 && point === 0 && Number(pVal) > 0) {
              point = Number(pVal);
            }
          }
        } else {
          // Standard tab alignment
          credit = Number(p1) || 3;
          ects = Number(p2) || credit;

          for (let pIdx = 3; pIdx < parts.length; pIdx++) {
            const pVal = parts[pIdx].replace(/\*/g, '').trim();
            if (/^([A-D][+-]?|F|FX|P|NP|IP)$/i.test(pVal)) {
              letterGrade = pVal.toUpperCase();
            } else if (/^\d+(\.\d+)?$/.test(pVal) && Number(pVal) <= 4.0 && point === 0 && Number(pVal) > 0) {
              point = Number(pVal);
            }
          }
        }
      } else {
        // Fallback space-separated regex
        const m = rest.match(/(.*?)\s+(\d+)\s+(\d+)\s+(?:\*{1,2}\s*)?(\d{1,3}|IP)?\s*([A-D][+-]?|P|NP|IP)\s*(?:(\d+(?:\.\d+)?)\s+)?(Good|Excellent|Satisfactory|Pass|In progress)?$/i);
        if (m) {
          title = m[1].trim();
          credit = Number(m[2]);
          ects = Number(m[3]);
          letterGrade = m[5].toUpperCase();
          point = Number(m[6]) || 0;
        } else {
          title = rest;
        }
      }

      // Clean title from trailing digits or misplaced markers
      title = title.replace(/\s+\d+\s*$/, '').trim();

      const normalized = normalizeGrade(letterGrade);
      if (point === 0 && normalized.gpa > 0) {
        point = normalized.gpa;
      }

      parsedCourses.push(matchWithCatalog({
        course_code: courseCode,
        course_name: title || courseCode,
        credits: ects > 0 ? ects : (credit || 5),
        grade: normalized.grade,
        gpa_points: point,
        semester: currentSemester || 'Completed'
      }, catalogCourses));
    }

    i++;
  }

  if (parsedCourses.length === 0) {
    throw new Error('Could not recognize the file: No courses could be extracted.');
  }

  // Deduplicate by course_code (keep latest)
  const deduped = [];
  const seen = new Set();
  for (const c of parsedCourses) {
    if (!seen.has(c.course_code)) {
      seen.add(c.course_code);
      deduped.push(c);
    }
  }

  const summary = computeSummary(deduped);
  return {
    courses: deduped,
    unmatchedCount: deduped.filter(c => !c.matched).length,
    studentId: detectedStudentId,
    studentName: detectedStudentName,
    siteUsername: siteUsername,
    isVerified: true,
    ...summary
  };
}

/**
 * Parse XLSX / XLS transcript buffer
 */
export function parseXlsxBuffer(buffer, catalogCourses = [], authUser = {}) {
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    throw new Error('Could not recognize the file: Excel workbook is empty.');
  }

  const sheet = workbook.Sheets[sheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length === 0) {
    throw new Error('Could not recognize the file: No data found in the spreadsheet.');
  }

  // Anti-Fake / Student ID & Name verification in spreadsheet headers
  let detectedStudentId = null;
  let detectedStudentName = null;
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const rowStr = (rows[r] || []).join(' ');
    const idMatch = rowStr.match(/Student\s*(?:№|No|#)?\s*:\s*(\d{7,12})/i) ||
                    rowStr.match(/\bID\s*:\s*(\d{7,12})/i);
    if (idMatch && !detectedStudentId) detectedStudentId = idMatch[1];
    const nameMatch = rowStr.match(/Student\s*Name\s*:\s*([^\t\r\n]+)/i);
    if (nameMatch && !detectedStudentName) detectedStudentName = nameMatch[1].trim();
  }

  if (!detectedStudentId) {
    const err = new Error(
      '⛔ Verification Error (Anti-Fake): Official Student ID (Student №) not found in the spreadsheet. Please upload an official SDU transcript.'
    );
    err.status = 400;
    throw err;
  }

  const siteUsername = String(authUser.username || '').trim();
  if (!siteUsername) {
    const err = new Error(
      '⛔ Authorization Error: Could not determine your SDU Login (username). Please log in again.'
    );
    err.status = 401;
    throw err;
  }

  const fileStudentId = String(detectedStudentId).trim();
  const isOwner = fileStudentId === siteUsername;

  if (!isOwner) {
    const err = new Error(
      `⛔ Verification Error (Anti-Fake): ID in spreadsheet (${fileStudentId}) does not match your SDU Login on the website (${siteUsername}). Upload rejected!`
    );
    err.status = 400;
    throw err;
  }

  const parsedCourses = [];
  let currentSemester = '';

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row) || row.length === 0) continue;

    const rowStr = row.join(' ');
    // Detect semester line
    const semMatch = rowStr.match(/\b(Fall|Spring|Summer)\s*(20\d\d)\b/i) ||
                     rowStr.match(/\b(20\d\d)\s*[-/]\s*(20\d\d)\s*(Fall|Spring|Summer|[12])/i) ||
                     rowStr.match(/^(\d{4})\s*-\s*(\d{4})\s*\.\s*([12])/);
    if (semMatch) {
      currentSemester = semMatch[0];
    }

    let courseCode = null;
    let codeColIdx = -1;

    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c]).trim();
      const codeMatch = cell.match(/\b([A-Za-z]{2,5})\s*[-_]?\s*(\d{3,4}[A-Za-z]?)\b/);
      if (codeMatch) {
        const prefix = codeMatch[1].toUpperCase();
        if (!/^(FALL|SPRING|SUMMER|WINTER|SEMESTER|YEAR|ECTS|CODE|TERM|SDU|TOTAL|GRADE|CREDIT|PAGE)$/i.test(prefix)) {
          courseCode = normalizeCourseCode(codeMatch[0]);
          codeColIdx = c;
          break;
        }
      }
    }

    if (!courseCode) continue;

    let courseName = '';
    let credits = 5;
    let rawGrade = 'A';

    for (let c = 0; c < row.length; c++) {
      if (c === codeColIdx) continue;
      const val = String(row[c]).trim();
      if (!val) continue;

      if (/^([A-D][+-]?|F|FX|P|NP|IP)$/i.test(val)) {
        rawGrade = val.toUpperCase();
      } else if (/^\d{1,3}(?:\.\d+)?$/.test(val)) {
        const n = parseFloat(val);
        if (n >= 1 && n <= 15 && credits === 5) {
          credits = n;
        } else if (n >= 0 && n <= 100) {
          rawGrade = val;
        }
      } else if (val.length > 3 && !courseName && !val.includes(currentSemester)) {
        courseName = val;
      }
    }

    const { grade, gpa } = normalizeGrade(rawGrade);

    parsedCourses.push(matchWithCatalog({
      course_code: courseCode,
      course_name: courseName || courseCode,
      credits: Number(credits) || 5,
      grade,
      gpa_points: gpa,
      semester: currentSemester || 'Completed'
    }, catalogCourses));
  }

  if (parsedCourses.length === 0) {
    throw new Error('Could not recognize the file: No course codes or grades could be found.');
  }

  // Deduplicate
  const deduped = [];
  const seen = new Set();
  for (const c of parsedCourses) {
    if (!seen.has(c.course_code)) {
      seen.add(c.course_code);
      deduped.push(c);
    }
  }

  const summary = computeSummary(deduped);
  return {
    courses: deduped,
    unmatchedCount: deduped.filter(c => !c.matched).length,
    studentId: detectedStudentId,
    studentName: detectedStudentName,
    siteUsername: siteUsername,
    isVerified: true,
    ...summary
  };
}

/**
 * Universal dispatcher
 */
export async function parseTranscript(buffer, fileName = '', catalogCourses = [], authUser = {}) {
  const ext = fileName.toLowerCase().split('.').pop();

  if (ext === 'xlsx' || ext === 'xls') {
    return parseXlsxBuffer(buffer, catalogCourses, authUser);
  }

  if (ext === 'pdf') {
    return await parsePdfBuffer(buffer, catalogCourses, authUser);
  }

  if (buffer.subarray(0, 4).toString() === '%PDF') {
    return await parsePdfBuffer(buffer, catalogCourses, authUser);
  }

  try {
    return parseXlsxBuffer(buffer, catalogCourses, authUser);
  } catch {
    throw new Error('Could not recognize the file: Please upload an official PDF or XLSX file.');
  }
}

/**
 * Story 10: Computes full academic progress per semester, cumulative GPA trend,
 * credits progress towards degree completion, and grade distribution.
 */
export function computeAcademicProgress(courses = [], requiredCredits = 240) {
  const normalized = courses.map(c => {
    const cred = Number(c.credits) || 0;
    const gradeInfo = normalizeGrade(c.grade);
    const gpa = c.gpa_points != null ? Number(c.gpa_points) : gradeInfo.gpa;
    return {
      ...c,
      credits: cred,
      grade: gradeInfo.grade,
      gpa_points: gpa,
      semester: String(c.semester || 'Completed').trim()
    };
  });

  // Group courses by semester
  const semesterMap = new Map();
  for (const c of normalized) {
    const sem = c.semester || 'Other';
    if (!semesterMap.has(sem)) {
      semesterMap.set(sem, []);
    }
    semesterMap.get(sem).push(c);
  }

  // Helper to sort semesters chronologically (Fall YYYY < Spring YYYY+1)
  function parseSemesterKey(semStr) {
    const yearMatch = semStr.match(/(\d{4})\s*-\s*(\d{4})\s*\.\s*([12])/);
    if (yearMatch) {
      return Number(yearMatch[1]) * 10 + Number(yearMatch[3]);
    }
    const yearOnly = semStr.match(/\b(20\d\d)\b/);
    const isSpring = /spring|весна/i.test(semStr);
    const isFall = /fall|осень/i.test(semStr);
    const isSummer = /summer|лето/i.test(semStr);
    const year = yearOnly ? Number(yearOnly[1]) : 2020;
    const term = isFall ? 1 : isSpring ? 2 : isSummer ? 3 : 1;
    return year * 10 + term;
  }

  const sortedSemesterKeys = Array.from(semesterMap.keys()).sort((a, b) => {
    return parseSemesterKey(a) - parseSemesterKey(b);
  });

  let runningEarnedCredits = 0;
  let runningGpaCredits = 0;
  let runningGradePoints = 0;

  const semesters = [];

  for (const semName of sortedSemesterKeys) {
    const semCourses = semesterMap.get(semName);
    let termEarnedCredits = 0;
    let termGpaCredits = 0;
    let termGradePoints = 0;

    for (const c of semCourses) {
      const cred = c.credits;
      const gpa = c.gpa_points;
      const grade = c.grade;

      // SDU GPA formula excludes P, NP, IP, W, I
      if (grade !== 'P' && grade !== 'NP' && grade !== 'IP' && grade !== 'W' && grade !== 'I') {
        termGradePoints += cred * gpa;
        termGpaCredits += cred;

        runningGradePoints += cred * gpa;
        runningGpaCredits += cred;
      }

      if (gpa >= 1.0 || grade === 'P') {
        termEarnedCredits += cred;
        runningEarnedCredits += cred;
      }
    }

    const termGpa = termGpaCredits > 0 ? Number((termGradePoints / termGpaCredits).toFixed(2)) : 0.00;
    const cumulativeGpa = runningGpaCredits > 0 ? Number((runningGradePoints / runningGpaCredits).toFixed(2)) : 0.00;

    semesters.push({
      semester: semName,
      coursesCount: semCourses.length,
      termEarnedCredits,
      termGpaCredits,
      termGpa,
      cumulativeEarnedCredits: runningEarnedCredits,
      cumulativeGpa,
      courses: semCourses
    });
  }

  // Grade distribution
  const gradeDistribution = {
    'A': 0, 'A-': 0,
    'B+': 0, 'B': 0, 'B-': 0,
    'C+': 0, 'C': 0, 'C-': 0,
    'D+': 0, 'D': 0,
    'F': 0, 'FX': 0,
    'P': 0, 'IP': 0
  };

  for (const c of normalized) {
    const g = c.grade;
    if (gradeDistribution[g] !== undefined) {
      gradeDistribution[g]++;
    } else if (g === 'NP') {
      gradeDistribution['F'] = (gradeDistribution['F'] || 0) + 1;
    }
  }

  const overall = computeSummary(normalized);
  const totalEarnedCredits = overall.totalCredits;
  const targetCredits = Number(requiredCredits) || 240;
  const completionPercentage = targetCredits > 0
    ? Number(Math.min(100, (totalEarnedCredits / targetCredits) * 100).toFixed(1))
    : 0;
  const remainingCredits = Math.max(0, targetCredits - totalEarnedCredits);

  return {
    cumulativeGpa: overall.estimatedGpa,
    totalEarnedCredits,
    requiredCredits: targetCredits,
    remainingCredits,
    completionPercentage,
    totalCoursesCount: normalized.length,
    semesters,
    gradeDistribution
  };
}
