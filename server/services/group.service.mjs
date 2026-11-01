import { groupRepository } from '../repositories/group.repository.mjs';
import { userRepository } from '../repositories/user.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class GroupService {
  async listGroups() {
    return groupRepository.listGroups();
  }

  async createGroup({ name, program, study_year = 1, advisor_username = null }) {
    const existing = await groupRepository.findGroupByName(name);
    if (existing) {
      throw HttpError.badRequest(`Group '${name}' already exists`);
    }

    if (advisor_username) {
      const advisor = await userRepository.findByUsername(advisor_username);
      if (!advisor) {
        throw HttpError.badRequest(`Advisor user '${advisor_username}' not found in the system`);
      }
    }

    return groupRepository.createGroup({ name, program, study_year, advisor_username });
  }

  async assignAdvisor(groupId, advisor_username) {
    const group = await groupRepository.findGroupById(groupId);
    if (!group) {
      throw HttpError.notFound('Group not found');
    }

    if (advisor_username) {
      const advisor = await userRepository.findByUsername(advisor_username);
      if (!advisor) {
        throw HttpError.badRequest(`Advisor user '${advisor_username}' not found in the system`);
      }
    }

    const updated = await groupRepository.assignAdvisor(groupId, advisor_username || null);
    return groupRepository.findGroupById(groupId);
  }

  async getStudentAdvisor(username) {
    if (!username) {
      return { group: null, advisor: null };
    }

    const membership = await groupRepository.getStudentGroupAndAdvisor(username);
    if (!membership) {
      return { group: null, advisor: null };
    }

    return {
      group: {
        id: membership.group_id,
        name: membership.group_name,
        program: membership.program,
        study_year: membership.study_year,
      },
      advisor: membership.advisor_username ? {
        username: membership.advisor_username,
        display_name: membership.advisor_display_name,
        avatar_url: membership.advisor_avatar_url,
        role: membership.advisor_role || 'Advisor',
      } : null,
    };
  }

  parseCsv(csvContent) {
    if (!csvContent || typeof csvContent !== 'string') {
      throw HttpError.badRequest('Invalid or empty CSV content');
    }

    const rawLines = csvContent.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (rawLines.length === 0) {
      throw HttpError.badRequest('CSV content has no readable rows');
    }

    // Detect delimiter: comma, semicolon, tab
    const firstLine = rawLines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semicolonCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    let delimiter = ',';
    if (semicolonCount > commaCount && semicolonCount >= tabCount) delimiter = ';';
    else if (tabCount > commaCount && tabCount > semicolonCount) delimiter = '\t';

    const parseLine = (line) => line.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''));

    const headerTokens = parseLine(rawLines[0]).map((h) => h.toLowerCase());
    const isHeader = headerTokens.some((t) => 
      ['group', 'group_name', 'groupname', 'группа', 'username', 'student', 'student_username', 'студент'].includes(t)
    );

    let colIndices = { group: 0, program: -1, study_year: -1, student: 1 };
    let startRow = 0;

    if (isHeader) {
      startRow = 1;
      headerTokens.forEach((token, idx) => {
        if (['group', 'group_name', 'groupname', 'группа'].includes(token)) colIndices.group = idx;
        else if (['program', 'major', 'специальность', 'программа'].includes(token)) colIndices.program = idx;
        else if (['study_year', 'year', 'курс', 'studyyear'].includes(token)) colIndices.study_year = idx;
        else if (['username', 'student', 'student_username', 'student_id', 'логин', 'студент'].includes(token)) colIndices.student = idx;
      });
    }

    const rows = [];
    const uniqueGroups = new Set();
    const uniqueStudents = new Set();

    for (let i = startRow; i < rawLines.length; i++) {
      const parts = parseLine(rawLines[i]);
      if (parts.length < 2) continue;

      let groupName = parts[colIndices.group] || '';
      let studentUsername = parts[colIndices.student] || '';

      // Fallback if 2 columns without header (Col 0 = Group, Col 1 = Student)
      if (!isHeader && parts.length === 2) {
        groupName = parts[0];
        studentUsername = parts[1];
      } else if (!isHeader && parts.length >= 4) {
        groupName = parts[0];
        studentUsername = parts[3];
      }

      if (!groupName || !studentUsername) continue;

      const program = colIndices.program >= 0 && parts[colIndices.program]
        ? parts[colIndices.program]
        : (!isHeader && parts[1] && parts.length >= 4 ? parts[1] : 'Information Systems');

      const yearRaw = colIndices.study_year >= 0 && parts[colIndices.study_year]
        ? parts[colIndices.study_year]
        : (!isHeader && parts[2] && parts.length >= 4 ? parts[2] : '1');
      const studyYear = Math.max(1, Math.min(6, parseInt(yearRaw, 10) || 1));

      uniqueGroups.add(groupName);
      uniqueStudents.add(studentUsername);

      rows.push({
        group_name: groupName,
        program,
        study_year: studyYear,
        student_username: studentUsername,
      });
    }

    if (rows.length === 0) {
      throw HttpError.badRequest('Could not parse any valid student and group records from CSV');
    }

    return {
      groupsCount: uniqueGroups.size,
      studentsCount: uniqueStudents.size,
      groups: Array.from(uniqueGroups),
      totalRows: rows.length,
      sampleRows: rows.slice(0, 10),
      rows,
    };
  }

  async executeImport(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw HttpError.badRequest('No rows provided for import');
    }

    // 1. Group records by group_name to optimize group creation
    const groupMap = new Map();
    for (const r of rows) {
      if (!groupMap.has(r.group_name)) {
        groupMap.set(r.group_name, {
          name: r.group_name,
          program: r.program || 'Information Systems',
          study_year: r.study_year || 1,
        });
      }
    }

    // 2. Upsert each group
    const createdGroups = new Map();
    for (const [name, gData] of groupMap.entries()) {
      const g = await groupRepository.upsertGroup(gData);
      createdGroups.set(name, g.id);
    }

    // 3. For each student, ensure user exists in users table and enroll into group
    let enrolledCount = 0;
    for (const row of rows) {
      const groupId = createdGroups.get(row.group_name);
      if (!groupId) continue;

      // Ensure user account exists
      await userRepository.findOrCreateUser(row.student_username);

      // Enroll student into group (constraint ensures at most one group per student)
      await groupRepository.enrollStudent(groupId, row.student_username);
      enrolledCount++;
    }

    return {
      success: true,
      groupsCount: createdGroups.size,
      studentsEnrolled: enrolledCount,
    };
  }
}

export const groupService = new GroupService();
