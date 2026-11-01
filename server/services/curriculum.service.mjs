import * as XLSX from 'xlsx';
import { curriculumRepository } from '../repositories/curriculum.repository.mjs';
import { groupRepository } from '../repositories/group.repository.mjs';
import { userRepository } from '../repositories/user.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class CurriculumService {
  parseFile(fileBufferOrBase64) {
    let buffer;
    if (typeof fileBufferOrBase64 === 'string') {
      // Strip data uri prefix if present
      const base64Data = fileBufferOrBase64.replace(/^data:.*?;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      buffer = fileBufferOrBase64;
    }

    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw HttpError.badRequest('The uploaded file contains no sheets');
    }

    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (!rows || rows.length === 0) {
      throw HttpError.badRequest('No rows found in the uploaded file');
    }

    const courses = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Normalize column keys
      const keys = Object.keys(row);
      const findVal = (patterns) => {
        for (const k of keys) {
          const cleanK = k.trim().toLowerCase();
          if (patterns.some((p) => cleanK.includes(p))) {
            return String(row[k]).trim();
          }
        }
        return '';
      };

      const semRaw = findVal(['sem', 'семестр', 'term']);
      const codeRaw = findVal(['code', 'код', 'course_code', 'course code']);
      const nameRaw = findVal(['name', 'title', 'название', 'course_name', 'course name']);
      const ectsRaw = findVal(['ects', 'credit', 'кредит']);
      const typeRaw = findVal(['type', 'тип', 'kind', 'status']);

      if (!codeRaw && !nameRaw) continue; // skip empty rows

      const semester = parseInt(semRaw, 10) || 1;
      const courseCode = (codeRaw || 'UNKNOWN').toUpperCase().trim();
      const courseName = nameRaw || courseCode;
      const ects = parseInt(ectsRaw, 10) || 5;
      const courseType = typeRaw || 'Mandatory';

      courses.push({
        semester,
        course_code: courseCode,
        course_name: courseName,
        ects,
        course_type: courseType,
      });
    }

    if (courses.length === 0) {
      throw HttpError.badRequest('Could not parse any courses from file. Ensure columns contain Semester and Course Code.');
    }

    return courses;
  }

  async validateCourses(courses) {
    const catalogMap = await curriculumRepository.getCatalogCourses();
    const unmappedCodesSet = new Set();

    const validated = courses.map((c) => {
      const cleanCode = c.course_code.toUpperCase().trim();
      const inCatalog = catalogMap.has(cleanCode);
      if (!inCatalog) {
        unmappedCodesSet.add(cleanCode);
      }
      return {
        ...c,
        course_code: cleanCode,
        is_mapped: inCatalog,
      };
    });

    return {
      courses: validated,
      unmapped_codes: Array.from(unmappedCodesSet),
      is_valid: unmappedCodesSet.size === 0,
    };
  }

  async previewCurriculum({ fileBase64, rawCourses }) {
    let courses = [];
    if (fileBase64) {
      courses = this.parseFile(fileBase64);
    } else if (Array.isArray(rawCourses) && rawCourses.length > 0) {
      courses = rawCourses;
    } else {
      throw HttpError.badRequest('No curriculum data or file provided');
    }

    const validation = await this.validateCourses(courses);

    // Group by semester for preview
    const semestersMap = new Map();
    let totalEcts = 0;

    for (const c of validation.courses) {
      totalEcts += Number(c.ects) || 0;
      if (!semestersMap.has(c.semester)) {
        semestersMap.set(c.semester, []);
      }
      semestersMap.get(c.semester).push(c);
    }

    const semestersBreakdown = Array.from(semestersMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([no, semCourses]) => ({
        semester: no,
        course_count: semCourses.length,
        ects_sum: semCourses.reduce((sum, curr) => sum + (Number(curr.ects) || 0), 0),
        courses: semCourses,
      }));

    return {
      total_courses: courses.length,
      total_ects: totalEcts,
      semesters: semestersBreakdown,
      unmapped_codes: validation.unmapped_codes,
      is_valid: validation.is_valid,
    };
  }

  async importCurriculum({
    program,
    academic_year,
    version_title,
    is_published = false,
    fileBase64,
    rawCourses,
  }) {
    if (!program || !String(program).trim()) {
      throw HttpError.badRequest('Program/Major is required');
    }
    const cleanProgram = String(program).trim();
    const cleanYear = parseInt(academic_year, 10) || new Date().getFullYear();
    const cleanTitle = String(version_title || `${cleanProgram} ${cleanYear}`).trim();

    let courses = [];
    if (fileBase64) {
      courses = this.parseFile(fileBase64);
    } else if (Array.isArray(rawCourses) && rawCourses.length > 0) {
      courses = rawCourses;
    } else {
      throw HttpError.badRequest('Curriculum courses or file must be provided');
    }

    const validation = await this.validateCourses(courses);

    if (is_published && !validation.is_valid) {
      throw HttpError.badRequest(
        `Cannot publish curriculum with unknown course codes: ${validation.unmapped_codes.join(', ')}`
      );
    }

    const curriculum = await curriculumRepository.createCurriculum({
      program: cleanProgram,
      academic_year: cleanYear,
      version_title: cleanTitle,
      is_published: Boolean(is_published),
    });

    await curriculumRepository.addCurriculumCourses(curriculum.id, validation.courses);

    return {
      curriculum,
      total_courses: courses.length,
      unmapped_codes: validation.unmapped_codes,
      is_valid: validation.is_valid,
    };
  }

  async listCurriculums() {
    return curriculumRepository.listCurriculums();
  }

  async getCurriculumDetails(id) {
    const curr = await curriculumRepository.getCurriculumById(id);
    if (!curr) throw HttpError.notFound('Curriculum not found');

    const courses = await curriculumRepository.getCurriculumCourses(id);
    const catalogMap = await curriculumRepository.getCatalogCourses();

    const semMap = new Map();
    const unmappedCodes = new Set();

    for (const c of courses) {
      const inCatalog = catalogMap.has(c.course_code.toUpperCase().trim());
      if (!inCatalog) unmappedCodes.add(c.course_code);

      if (!semMap.has(c.semester)) semMap.set(c.semester, []);
      semMap.get(c.semester).push({
        ...c,
        is_mapped: inCatalog,
      });
    }

    const semesters = Array.from(semMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([no, sCourses]) => ({
        no,
        courses: sCourses,
      }));

    return {
      ...curr,
      unmapped_codes: Array.from(unmappedCodes),
      semesters,
    };
  }

  async setPublished(id, isPublished) {
    const curr = await curriculumRepository.getCurriculumById(id);
    if (!curr) throw HttpError.notFound('Curriculum not found');

    if (isPublished) {
      // Validate no unmapped courses exist
      const courses = await curriculumRepository.getCurriculumCourses(id);
      const catalogMap = await curriculumRepository.getCatalogCourses();
      const unmapped = courses
        .map((c) => c.course_code.toUpperCase().trim())
        .filter((code) => !catalogMap.has(code));

      if (unmapped.length > 0) {
        throw HttpError.badRequest(
          `Cannot publish curriculum with unknown course codes: ${Array.from(new Set(unmapped)).join(', ')}`
        );
      }
    }

    return curriculumRepository.setPublished(id, isPublished);
  }

  async deleteCurriculum(id) {
    const curr = await curriculumRepository.getCurriculumById(id);
    if (!curr) throw HttpError.notFound('Curriculum not found');
    await curriculumRepository.deleteCurriculum(id);
    return { success: true };
  }

  async listAssignedStudents(curriculumId) {
    const curr = await curriculumRepository.getCurriculumById(curriculumId);
    if (!curr) throw HttpError.notFound('Curriculum not found');
    return curriculumRepository.listAssignedStudents(curriculumId);
  }

  async assignStudent(curriculumId, username) {
    const curr = await curriculumRepository.getCurriculumById(curriculumId);
    if (!curr) throw HttpError.notFound('Curriculum not found');

    const cleanUsername = String(username || '').trim();
    if (!cleanUsername) throw HttpError.badRequest('Username cannot be empty');

    const user = await userRepository.findByUsername(cleanUsername);
    if (!user) {
      throw HttpError.badRequest(`User '${cleanUsername}' does not exist on the platform`);
    }

    await curriculumRepository.assignStudent(curriculumId, cleanUsername);
    return curriculumRepository.listAssignedStudents(curriculumId);
  }

  async removeStudent(curriculumId, username) {
    const curr = await curriculumRepository.getCurriculumById(curriculumId);
    if (!curr) throw HttpError.notFound('Curriculum not found');

    const cleanUsername = String(username || '').trim();
    await curriculumRepository.removeStudent(curriculumId, cleanUsername);
    return curriculumRepository.listAssignedStudents(curriculumId);
  }

  async getCurriculumForStudent(username, studentCompletedCourses = [], sduCurriculum = null) {
    if (!username) return null;

    // 1. Direct student-to-curriculum assignment
    let published = await curriculumRepository.getAssignedCurriculumForUser(username);
    let trackName = published?.version_title || 'Assigned Track';

    // 2. Fallback: group membership published curriculum
    if (!published) {
      const membership = await groupRepository.getStudentGroupAndAdvisor(username);
      if (membership) {
        published = await curriculumRepository.findPublishedCurriculum(membership.program);
        trackName = membership.group_name;
      }
    }

    if (!published) return null;

    const courses = await curriculumRepository.getCurriculumCourses(published.id);

    // Map student's completed courses for status
    const completedMap = new Map();
    for (const sc of studentCompletedCourses) {
      if (sc.code) {
        completedMap.set(sc.code.toUpperCase().trim(), sc);
      }
    }

    // Map SDU curriculum courses to preserve sectionsParams, mufSqId, etc.
    const sduCoursesMap = new Map();
    if (sduCurriculum?.semesters) {
      for (const s of sduCurriculum.semesters) {
        for (const sc of s.courses || []) {
          if (sc.code) {
            sduCoursesMap.set(sc.code.toUpperCase().trim(), sc);
          }
        }
      }
    }

    const semMap = new Map();
    for (const c of courses) {
      const cleanCode = c.course_code.toUpperCase().trim();
      const userCourse = completedMap.get(cleanCode);
      const sduCourse = sduCoursesMap.get(cleanCode);

      const status = userCourse ? userCourse.status : (sduCourse?.status || 'not_taken');
      const grade = userCourse ? userCourse.grade : (sduCourse?.grade || null);

      if (!semMap.has(c.semester)) semMap.set(c.semester, []);
      semMap.get(c.semester).push({
        code: cleanCode,
        name: c.course_name,
        ects: String(c.ects),
        status,
        grade,
        type: c.course_type,
        sectionsParams: sduCourse?.sectionsParams,
        mufSqId: sduCourse?.mufSqId,
        elective: sduCourse?.elective,
        isElective: Boolean(c.course_type && c.course_type.toLowerCase().includes('elective')),
      });
    }

    const semesters = Array.from(semMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([no, sCourses]) => ({
        no,
        courses: sCourses,
      }));

    return {
      program: {
        title: published.version_title,
        year: published.academic_year,
        name: published.program,
        track: trackName,
      },
      semesters,
    };
  }
}

export const curriculumService = new CurriculumService();
