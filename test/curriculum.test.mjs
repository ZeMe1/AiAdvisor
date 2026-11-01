import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import { curriculumService } from '../server/services/curriculum.service.mjs';
import { curriculumRepository } from '../server/repositories/curriculum.repository.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';
import { userRepository } from '../server/repositories/user.repository.mjs';
import { initDb, pool } from '../server/db.mjs';

describe('US14: Import the Curriculum Plan', () => {
  const cleanup = async () => {
    await pool.query("DELETE FROM program_curriculums WHERE program LIKE 'TEST-%'");
    await pool.query("DELETE FROM group_members WHERE username LIKE 'test_curr_%'");
    await pool.query("DELETE FROM student_groups WHERE name LIKE 'TEST-CURR-%'");
    await pool.query("DELETE FROM users WHERE username LIKE 'test_curr_%'");
  };

  beforeAll(async () => {
    await initDb();
    await cleanup();
  }, 15000);

  afterAll(async () => {
    await cleanup();
  }, 15000);

  it('Scenario 1: Administrator imports curriculum for Computer Science 2023 from XLSX/CSV and publishes it', async () => {
    // Generate sample curriculum rows for CS 2023
    const sampleRows = [
      { Semester: 1, 'Course Code': 'CSS 105', 'Course Name': 'Fundamentals of Programming', ECTS: 5, Type: 'Mandatory' },
      { Semester: 1, 'Course Code': 'MAT 137', 'Course Name': 'Mathematics 1', ECTS: 5, Type: 'Mandatory' },
      { Semester: 2, 'Course Code': 'CSS 108', 'Course Name': 'Programming Technologies', ECTS: 5, Type: 'Mandatory' },
      { Semester: 2, 'Course Code': 'MAT 138', 'Course Name': 'Mathematics 2', ECTS: 5, Type: 'Mandatory' },
    ];

    // Create a real XLSX buffer
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Curriculum');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const base64File = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsxBuffer.toString('base64')}`;

    // 1. Preview and validate file
    const preview = await curriculumService.previewCurriculum({ fileBase64: base64File });
    expect(preview.total_courses).toBe(4);
    expect(preview.is_valid).toBe(true);
    expect(preview.unmapped_codes).toHaveLength(0);
    expect(preview.semesters).toHaveLength(2);

    // 2. Import and publish curriculum
    const result = await curriculumService.importCurriculum({
      program: 'TEST-Computer Science',
      academic_year: 2023,
      version_title: 'TEST-Computer Science 2023',
      is_published: true,
      fileBase64: base64File,
    });

    expect(result.curriculum.id).toBeDefined();
    expect(result.curriculum.is_published).toBe(true);
    expect(result.total_courses).toBe(4);

    // 3. Verify curriculum details
    const details = await curriculumService.getCurriculumDetails(result.curriculum.id);
    expect(details.version_title).toBe('TEST-Computer Science 2023');
    expect(details.semesters).toHaveLength(2);
    expect(details.semesters[0].courses).toHaveLength(2);
    expect(details.semesters[0].courses[0].course_code).toBe('CSS 105');
  }, 15000);

  it('Scenario 2: Curriculum containing unknown course code (XX 999) flags unmapped codes and rejects publishing', async () => {
    const invalidRows = [
      { Semester: 1, 'Course Code': 'CSS 105', 'Course Name': 'Fundamentals of Programming', ECTS: 5, Type: 'Mandatory' },
      { Semester: 1, 'Course Code': 'XX 999', 'Course Name': 'Unknown Phantom Course', ECTS: 5, Type: 'Mandatory' },
    ];

    const ws = XLSX.utils.json_to_sheet(invalidRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Curriculum');
    const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const base64File = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${xlsxBuffer.toString('base64')}`;

    // 1. Preview shows unmapped code
    const preview = await curriculumService.previewCurriculum({ fileBase64: base64File });
    expect(preview.is_valid).toBe(false);
    expect(preview.unmapped_codes).toContain('XX 999');

    // 2. Attempting to import with is_published = true throws 400
    await expect(
      curriculumService.importCurriculum({
        program: 'TEST-Invalid Program',
        academic_year: 2024,
        version_title: 'TEST-Invalid Program 2024',
        is_published: true,
        fileBase64: base64File,
      })
    ).rejects.toThrow(/Cannot publish curriculum with unknown course codes: XX 999/);

    // 3. Can be saved as draft
    const draft = await curriculumService.importCurriculum({
      program: 'TEST-Invalid Program',
      academic_year: 2024,
      version_title: 'TEST-Invalid Program 2024',
      is_published: false,
      fileBase64: base64File,
    });
    expect(draft.curriculum.is_published).toBe(false);

    // 4. Publishing draft directly fails while XX 999 is unresolved
    await expect(
      curriculumService.setPublished(draft.curriculum.id, true)
    ).rejects.toThrow(/Cannot publish curriculum with unknown course codes: XX 999/);
  }, 15000);

  it('Scenario 3: Multi-version support for different years of enrollment', async () => {
    // Version 2023
    const v2023 = await curriculumService.importCurriculum({
      program: 'TEST-Software Engineering',
      academic_year: 2023,
      version_title: 'TEST-SE 2023',
      is_published: true,
      rawCourses: [
        { semester: 1, course_code: 'CSS 105', course_name: 'Intro Prog', ects: 5, course_type: 'Mandatory' },
      ],
    });

    // Version 2024 (newer curriculum)
    const v2024 = await curriculumService.importCurriculum({
      program: 'TEST-Software Engineering',
      academic_year: 2024,
      version_title: 'TEST-SE 2024',
      is_published: true,
      rawCourses: [
        { semester: 1, course_code: 'CS 101', course_name: 'Intro CS', ects: 5, course_type: 'Mandatory' },
      ],
    });

    const activePublished = await curriculumRepository.findPublishedCurriculum('TEST-Software Engineering');
    expect(activePublished.version_title).toBe('TEST-SE 2024');
    expect(activePublished.academic_year).toBe(2024);
  }, 15000);

  it('Scenario 4: Student enrolled in group with published curriculum receives the mapped curriculum without overwriting completed student data', async () => {
    // 1. Create student and student group
    await userRepository.findOrCreateUser('test_curr_student1');
    const group = await groupRepository.createGroup({
      name: 'TEST-CURR-GRP-1',
      program: 'TEST-Computer Science',
      study_year: 2,
    });
    await groupRepository.enrollStudent(group.id, 'test_curr_student1');

    // 2. Student completed CSS 105 with grade A
    const studentCompletedCourses = [
      { code: 'CSS 105', status: 'passed', grade: 'A' },
      { code: 'MAT 137', status: 'passed', grade: 'B+' },
    ];

    // 3. Fetch curriculum for student
    const studentCurriculum = await curriculumService.getCurriculumForStudent(
      'test_curr_student1',
      studentCompletedCourses
    );

    expect(studentCurriculum).not.toBeNull();
    expect(studentCurriculum.program.name).toBe('TEST-Computer Science');
    expect(studentCurriculum.semesters).toHaveLength(2);

    const sem1 = studentCurriculum.semesters.find((s) => s.no === 1);
    const css105 = sem1.courses.find((c) => c.code === 'CSS 105');
    expect(css105.status).toBe('passed');
    expect(css105.grade).toBe('A');

    const sem2 = studentCurriculum.semesters.find((s) => s.no === 2);
    const css108 = sem2.courses.find((c) => c.code === 'CSS 108');
    expect(css108.status).toBe('not_taken');
    expect(css108.grade).toBeNull();
  }, 15000);

  it('Scenario 5: Administrator directly assigns student to a curriculum, and student receives this curriculum', async () => {
    // 1. Create student and curriculum
    await userRepository.findOrCreateUser('test_curr_assigned_student');

    const curr = await curriculumService.importCurriculum({
      program: 'TEST-Cybersecurity',
      academic_year: 2026,
      version_title: 'TEST-Cybersecurity 2026',
      is_published: false,
      rawCourses: [
        { semester: 1, course_code: 'INF 318', course_name: 'Computer Networks', ects: 5, course_type: 'Mandatory' },
        { semester: 1, course_code: 'INF 376', course_name: 'Information Security', ects: 5, course_type: 'Mandatory' },
      ],
    });

    // 2. Assign student to curriculum
    let students = await curriculumService.assignStudent(curr.curriculum.id, 'test_curr_assigned_student');
    expect(students).toHaveLength(1);
    expect(students[0].username).toBe('test_curr_assigned_student');

    // 3. Fails when assigning non-existent user
    await expect(
      curriculumService.assignStudent(curr.curriculum.id, 'ghost_nonexistent_user')
    ).rejects.toThrow(/does not exist on the platform/);

    // 4. Fetching curriculum for student returns this assigned curriculum
    const studentCurriculum = await curriculumService.getCurriculumForStudent('test_curr_assigned_student', []);
    expect(studentCurriculum).not.toBeNull();
    expect(studentCurriculum.program.title).toBe('TEST-Cybersecurity 2026');
    expect(studentCurriculum.semesters[0].courses.map((c) => c.code)).toContain('INF 318');

    // 5. Remove assignment
    students = await curriculumService.removeStudent(curr.curriculum.id, 'test_curr_assigned_student');
    expect(students).toHaveLength(0);

    const afterRemove = await curriculumService.getCurriculumForStudent('test_curr_assigned_student', []);
    expect(afterRemove).toBeNull();
  }, 15000);

  it('Scenario 6: Max 3 curriculums limit (including SDU portal) and roadmap switcher support', async () => {
    await userRepository.findOrCreateUser('test_curr_switcher_student');

    // Create 3 custom curriculums
    const c1 = await curriculumService.importCurriculum({
      program: 'TEST-Track-1',
      academic_year: 2024,
      version_title: 'TEST-Track 1',
      rawCourses: [{ semester: 1, course_code: 'CSS 105', course_name: 'Prog 1', ects: 5, course_type: 'Mandatory' }],
    });
    const c2 = await curriculumService.importCurriculum({
      program: 'TEST-Track-2',
      academic_year: 2025,
      version_title: 'TEST-Track 2',
      rawCourses: [{ semester: 1, course_code: 'CSS 108', course_name: 'Prog 2', ects: 5, course_type: 'Mandatory' }],
    });
    const c3 = await curriculumService.importCurriculum({
      program: 'TEST-Track-3',
      academic_year: 2026,
      version_title: 'TEST-Track 3',
      rawCourses: [{ semester: 1, course_code: 'CSS 215', course_name: 'DSA', ects: 5, course_type: 'Mandatory' }],
    });

    // Assign 1st custom curriculum
    await curriculumService.assignStudent(c1.curriculum.id, 'test_curr_switcher_student');
    // Assign 2nd custom curriculum
    await curriculumService.assignStudent(c2.curriculum.id, 'test_curr_switcher_student');

    // Attempting to assign 3rd custom curriculum must fail (since SDU portal counts as 1, max total is 3)
    await expect(
      curriculumService.assignStudent(c3.curriculum.id, 'test_curr_switcher_student')
    ).rejects.toThrow(/maximum limit of 3 curriculums/);

    // Verify roadmap options: SDU + 2 assigned = 3 total
    const mockSdu = {
      program: { title: 'Official SDU', name: 'SDU IS', track: 'Official' },
      semesters: [{ no: 1, courses: [{ code: 'CSS 105', name: 'Prog 1', ects: '5', status: 'passed', grade: 'A' }] }],
    };

    const roadmapData = await curriculumService.getRoadmapCurriculumsForStudent(
      'test_curr_switcher_student',
      [{ code: 'CSS 105', status: 'passed', grade: 'A' }],
      mockSdu
    );

    expect(roadmapData.curriculums).toHaveLength(3);
    expect(roadmapData.curriculums[0].id).toBe('sdu');
    expect(roadmapData.curriculums[1].title).toBe('TEST-Track 1');
    expect(roadmapData.curriculums[2].title).toBe('TEST-Track 2');
  }, 15000);
});
