import { describe, it, expect, beforeAll } from 'vitest';
import { groupService } from '../server/services/group.service.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';
import { userRepository } from '../server/repositories/user.repository.mjs';
import { initDb, pool } from '../server/db.mjs';

describe('US13: Manage Groups and Assign Advisors', () => {
  beforeAll(async () => {
    await initDb();
    // Clean up test data if any
    await pool.query("DELETE FROM group_members WHERE username LIKE 'test_%'");
    await pool.query("DELETE FROM student_groups WHERE name LIKE 'TEST-%'");
    await pool.query("DELETE FROM users WHERE username LIKE 'test_%'");
  }, 15000);

  it('Scenario 1: Administrator assigns an advisor to a group, and enrolled students see their assigned advisor', async () => {
    // 1. Create advisor user
    const advisorUser = await userRepository.findOrCreateUser('test_advisor_smith');
    await userRepository.updateRole('test_advisor_smith', 'Advisor');
    await userRepository.updateProfile('test_advisor_smith', {
      display_name: 'Dr. Jane Smith',
      avatar_url: 'https://example.com/avatar.jpg',
    });

    // 2. Administrator creates group 'TEST-CS-23-1'
    const group = await groupService.createGroup({
      name: 'TEST-CS-23-1',
      program: 'Computer Science',
      study_year: 2,
    });
    expect(group.id).toBeDefined();
    expect(group.name).toBe('TEST-CS-23-1');

    // 3. Administrator assigns advisor to group
    const updatedGroup = await groupService.assignAdvisor(group.id, 'test_advisor_smith');
    expect(updatedGroup.advisor_username).toBe('test_advisor_smith');
    expect(updatedGroup.advisor_display_name).toBe('Dr. Jane Smith');

    // 4. Enroll student 'test_student_bob' into 'TEST-CS-23-1'
    await userRepository.findOrCreateUser('test_student_bob');
    await groupRepository.enrollStudent(group.id, 'test_student_bob');

    // 5. Student queries their advisor (<My advisor> section)
    const studentView = await groupService.getStudentAdvisor('test_student_bob');
    expect(studentView.group).not.toBeNull();
    expect(studentView.group.name).toBe('TEST-CS-23-1');
    expect(studentView.group.program).toBe('Computer Science');
    expect(studentView.group.study_year).toBe(2);

    expect(studentView.advisor).not.toBeNull();
    expect(studentView.advisor.username).toBe('test_advisor_smith');
    expect(studentView.advisor.display_name).toBe('Dr. Jane Smith');
    expect(studentView.advisor.role).toBe('Advisor');
  }, 15000);

  it('Scenario 2: Administrator imports groups and students from CSV with preview validation', async () => {
    const csvData = `group_name,program,study_year,student_username
TEST-SE-24-1,Software Engineering,1,test_student_alice
TEST-SE-24-1,Software Engineering,1,test_student_charlie
TEST-DS-22-1,Data Science,3,test_student_david`;

    // 1. Preview shows count of groups and students before confirmation
    const preview = groupService.parseCsv(csvData);
    expect(preview.groupsCount).toBe(2);
    expect(preview.studentsCount).toBe(3);
    expect(preview.totalRows).toBe(3);
    expect(preview.groups).toContain('TEST-SE-24-1');
    expect(preview.groups).toContain('TEST-DS-22-1');
    expect(preview.sampleRows).toHaveLength(3);

    // 2. Confirm & execute import
    const importResult = await groupService.executeImport(preview.rows);
    expect(importResult.success).toBe(true);
    expect(importResult.groupsCount).toBe(2);
    expect(importResult.studentsEnrolled).toBe(3);

    // 3. Verify students were enrolled into their respective groups
    const aliceData = await groupService.getStudentAdvisor('test_student_alice');
    expect(aliceData.group.name).toBe('TEST-SE-24-1');
    expect(aliceData.group.program).toBe('Software Engineering');

    const davidData = await groupService.getStudentAdvisor('test_student_david');
    expect(davidData.group.name).toBe('TEST-DS-22-1');
    expect(davidData.group.study_year).toBe(3);
  }, 15000);

  it('Constraint: A student must belong to at most one group at a time', async () => {
    const groupA = await groupService.createGroup({
      name: 'TEST-GRP-A',
      program: 'Cybersecurity',
      study_year: 1,
    });
    const groupB = await groupService.createGroup({
      name: 'TEST-GRP-B',
      program: 'Artificial Intelligence',
      study_year: 1,
    });

    // Enroll student into Group A
    await userRepository.findOrCreateUser('test_student_moving');
    await groupRepository.enrollStudent(groupA.id, 'test_student_moving');

    let membership = await groupService.getStudentAdvisor('test_student_moving');
    expect(membership.group.name).toBe('TEST-GRP-A');

    // Moving student to Group B
    await groupRepository.enrollStudent(groupB.id, 'test_student_moving');

    membership = await groupService.getStudentAdvisor('test_student_moving');
    expect(membership.group.name).toBe('TEST-GRP-B');

    // Check member list of Group A does not contain this student anymore
    const groupAMembers = await groupRepository.listGroupMembers(groupA.id);
    expect(groupAMembers.some((m) => m.username === 'test_student_moving')).toBe(false);

    // Check member list of Group B contains this student
    const groupBMembers = await groupRepository.listGroupMembers(groupB.id);
    expect(groupBMembers.some((m) => m.username === 'test_student_moving')).toBe(true);
  }, 15000);

  it('fails with 400 when assigning a non-existent advisor', async () => {
    const group = await groupRepository.findGroupByName('TEST-CS-23-1');
    await expect(
      groupService.assignAdvisor(group.id, 'test_ghost_advisor_nonexistent')
    ).rejects.toThrow(/not found in the system/);
  });

  it('correctly parses semicolon-delimited CSV files without headers', () => {
    const semicolonCsv = `TEST-GRP-X;Information Systems;2;test_student_semi1\nTEST-GRP-X;Information Systems;2;test_student_semi2`;
    const preview = groupService.parseCsv(semicolonCsv);
    expect(preview.groupsCount).toBe(1);
    expect(preview.studentsCount).toBe(2);
    expect(preview.rows[0].group_name).toBe('TEST-GRP-X');
    expect(preview.rows[0].student_username).toBe('test_student_semi1');
  });
});
