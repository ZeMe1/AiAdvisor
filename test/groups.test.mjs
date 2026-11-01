import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { groupService } from '../server/services/group.service.mjs';
import { groupRepository } from '../server/repositories/group.repository.mjs';
import { userRepository } from '../server/repositories/user.repository.mjs';
import { initDb, pool } from '../server/db.mjs';

describe('US13: Manage Groups and Assign Advisors', () => {
  const cleanup = async () => {
    await pool.query("DELETE FROM group_members WHERE username LIKE 'test_%'");
    await pool.query("DELETE FROM student_groups WHERE name LIKE 'TEST-%'");
    await pool.query("DELETE FROM users WHERE username LIKE 'test_%'");
  };

  beforeAll(async () => {
    await initDb();
    await cleanup();
  }, 15000);

  afterAll(async () => {
    await cleanup();
  }, 15000);

  it('Scenario 1: Administrator assigns an advisor to a group, and enrolled students see their assigned advisor', async () => {
    // 1. Create advisor user
    await userRepository.findOrCreateUser('test_advisor_smith');
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

  it('manages students in a group: enrolls, lists, and removes students', async () => {
    const group = await groupService.createGroup({
      name: 'TEST-CS-MEMBERS',
      program: 'Information Systems',
      study_year: 3,
    });

    // 1. Enroll students
    await groupService.enrollStudent(group.id, 'test_student_enroll1');
    await groupService.enrollStudent(group.id, 'test_student_enroll2');

    // 2. List members
    let members = await groupService.listGroupMembers(group.id);
    expect(members).toHaveLength(2);
    expect(members.map((m) => m.username)).toContain('test_student_enroll1');
    expect(members.map((m) => m.username)).toContain('test_student_enroll2');

    // 3. Remove student
    members = await groupService.removeStudent(group.id, 'test_student_enroll1');
    expect(members).toHaveLength(1);
    expect(members[0].username).toBe('test_student_enroll2');
  }, 15000);

  it('fails with 400 when assigning a non-existent advisor', async () => {
    const group = await groupRepository.findGroupByName('TEST-CS-23-1');
    await expect(
      groupService.assignAdvisor(group.id, 'test_ghost_advisor_nonexistent')
    ).rejects.toThrow(/not found in the system/);
  });
});
