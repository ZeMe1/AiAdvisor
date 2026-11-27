import { messagesRepository } from '../repositories/messages.repository.mjs';
import { groupRepository } from '../repositories/group.repository.mjs';
import { userRepository } from '../repositories/user.repository.mjs';
import { GRADE_POINTS } from './prerequisite.service.mjs';
import { presenceService } from './presence.service.mjs';
import { HttpError } from '../errors/http-error.mjs';

export const FORBIDDEN_ADVISOR_MSG = 'You can only message your own group advisor';

export function truncatePreview(text, maxLen = 75) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export function formatDirectMessage(row, viewerUsername = '') {
  if (!row) return null;
  const viewer = String(viewerUsername || '').trim().toLowerCase();
  const sender = String(row.sender_username || '').trim();
  return {
    id: Number(row.id),
    studentUsername: row.student_username,
    advisorUsername: row.advisor_username,
    groupId: row.group_id != null ? Number(row.group_id) : null,
    senderUsername: sender,
    isMine: Boolean(viewer && sender.toLowerCase() === viewer),
    content: row.content,
    isRead: Boolean(row.is_read),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
  };
}

export class MessagesService {
  normalizeContent(content, label = 'Message') {
    const clean = String(content ?? '').trim();
    if (!clean) {
      throw HttpError.badRequest(`${label} cannot be empty`);
    }
    if (clean.length > 2000) {
      throw HttpError.badRequest(`${label} cannot exceed 2000 characters`);
    }
    return clean;
  }

  async assertAdvisorOwnsStudent(advisorUsername, role, studentUsername) {
    if (!advisorUsername) {
      throw HttpError.unauthorized('not authenticated');
    }
    if (role !== 'Advisor') {
      throw HttpError.forbidden('Only advisors can access advisor conversations');
    }

    const cleanStudent = String(studentUsername || '').trim();
    if (!cleanStudent) {
      throw HttpError.badRequest('Student username is required');
    }

    const membership = await groupRepository.getStudentGroupAndAdvisor(cleanStudent);
    if (
      !membership ||
      !membership.advisor_username ||
      membership.advisor_username.toLowerCase() !== String(advisorUsername).trim().toLowerCase()
    ) {
      throw HttpError.forbidden('Access denied: student is not in your assigned groups');
    }

    return membership;
  }

  /**
   * US27: Build a strictly read-only academic snapshot for a student
   * (GPA, current semester ECTS load, last recommendation timestamp).
   */
  computeAcademicSnapshot(studentUsername, rawAcademicData) {
    const key = String(studentUsername || '').trim().toLowerCase();
    const sCache = rawAcademicData?.studentCacheByUser?.get(key) || null;
    const curriculum = rawAcademicData?.curriculumByUser?.get(key) || null;
    const plan = rawAcademicData?.plansByUser?.get(key) || null;
    const lastFeedbackAt = rawAcademicData?.lastFeedbackByUser?.get(key) || null;

    let gpa = null;
    let completedEcts = null;

    if (curriculum && Array.isArray(curriculum.semesters)) {
      const allCourses = curriculum.semesters.flatMap((s) => s.courses || []);
      const dedupByCode = new Map();

      for (const c of allCourses) {
        const code = c?.code ? String(c.code).toUpperCase().trim() : '';
        if (!code) continue;
        const prev = dedupByCode.get(code);
        const grade = c.grade ? String(c.grade).toUpperCase().trim() : null;
        const isPassed = c.status === 'passed' || (grade && !['F', 'FX', 'I', 'NA', 'IP'].includes(grade));
        if (!prev || isPassed) {
          dedupByCode.set(code, c);
        }
      }

      let qualityPoints = 0;
      let gpaEcts = 0;
      let passedEcts = 0;

      for (const c of dedupByCode.values()) {
        const ects = Number(c.ects) || 5;
        const grade = c.grade ? String(c.grade).toUpperCase().trim() : null;
        const isPassed = c.status === 'passed' || (grade && !['F', 'FX', 'I', 'NA', 'IP'].includes(grade));

        if (isPassed) {
          passedEcts += ects;
        }
        if (grade && GRADE_POINTS[grade] !== undefined && !['I', 'NA'].includes(grade)) {
          qualityPoints += GRADE_POINTS[grade] * ects;
          gpaEcts += ects;
        }
      }

      completedEcts = passedEcts;
      if (gpaEcts > 0) {
        gpa = Number((qualityPoints / gpaEcts).toFixed(2));
      }
    }

    if (gpa === null && sCache?.track?.gpa != null && !Number.isNaN(Number(sCache.track.gpa))) {
      gpa = Number(Number(sCache.track.gpa).toFixed(2));
    }

    let semesterLoadEcts = 0;
    let plannedCoursesCount = 0;
    if (plan && plan.total_ects != null) {
      semesterLoadEcts = Number(plan.total_ects) || 0;
      plannedCoursesCount = Array.isArray(plan.courses) ? plan.courses.length : 0;
    } else if (Array.isArray(sCache?.approved_courses) && sCache.approved_courses.length > 0) {
      semesterLoadEcts = sCache.approved_courses.reduce(
        (sum, c) => sum + (Number(c?.ects ?? c?.credits) || 5),
        0
      );
      plannedCoursesCount = sCache.approved_courses.length;
    }

    const candidates = [plan?.updated_at, lastFeedbackAt]
      .map((ts) => (ts ? new Date(ts) : null))
      .filter((d) => d && !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime());

    const lastRecommendationAt = candidates.length > 0 ? candidates[0].toISOString() : null;

    return {
      readOnly: true,
      gpa,
      gpaFormatted: gpa !== null ? gpa.toFixed(2) : '—',
      completedEcts,
      semesterLoadEcts,
      plannedCoursesCount,
      targetSemester: plan?.target_semester != null ? Number(plan.target_semester) : null,
      currentTerm: sCache?.term || null,
      lastRecommendationAt,
    };
  }

  /**
   * US26: Open 1-to-1 student <-> assigned group advisor conversation,
   * enforce strict group-advisor ACL, mark advisor's messages read,
   * and attach live advisor presence + office hours (US30).
   */
  async getStudentConversation(studentUsername, requestedAdvisorUsername = null) {
    if (!studentUsername) {
      throw HttpError.unauthorized('not authenticated');
    }
    const cleanStudent = String(studentUsername).trim();
    const requestedAdvisor = requestedAdvisorUsername ? String(requestedAdvisorUsername).trim() : null;

    const membership = await groupRepository.getStudentGroupAndAdvisor(cleanStudent);

    if (requestedAdvisor) {
      const assignedAdvisor = membership?.advisor_username || '';
      if (!assignedAdvisor || assignedAdvisor.toLowerCase() !== requestedAdvisor.toLowerCase()) {
        throw HttpError.forbidden(FORBIDDEN_ADVISOR_MSG);
      }
    }

    await presenceService.touchUserPresence(cleanStudent, true);

    if (!membership) {
      return {
        assigned: false,
        group: null,
        advisor: null,
        presence: null,
        messages: [],
      };
    }

    const group = {
      id: membership.group_id,
      name: membership.group_name,
      program: membership.program,
      study_year: membership.study_year,
    };

    if (!membership.advisor_username) {
      return {
        assigned: false,
        group,
        advisor: null,
        presence: null,
        messages: [],
      };
    }

    const advisorUsername = membership.advisor_username;
    await messagesRepository.markDialogRead(cleanStudent, advisorUsername, cleanStudent);

    const [rows, presence] = await Promise.all([
      messagesRepository.getDialogMessages(cleanStudent, advisorUsername),
      presenceService.getPresenceForUsername(advisorUsername),
    ]);

    return {
      assigned: true,
      group,
      advisor: {
        username: advisorUsername,
        display_name: membership.advisor_display_name,
        avatar_url: membership.advisor_avatar_url,
        role: membership.advisor_role || 'Advisor',
      },
      presence,
      messages: rows.map((r) => formatDirectMessage(r, cleanStudent)),
    };
  }

  /**
   * US26: Send plain-text message from student to their assigned group advisor.
   */
  async sendStudentMessage(studentUsername, { advisorUsername = null, content } = {}) {
    if (!studentUsername) {
      throw HttpError.unauthorized('not authenticated');
    }
    const cleanStudent = String(studentUsername).trim();
    const cleanContent = this.normalizeContent(content, 'Message');
    const requestedAdvisor = advisorUsername ? String(advisorUsername).trim() : null;

    const membership = await groupRepository.getStudentGroupAndAdvisor(cleanStudent);

    if (requestedAdvisor) {
      const assignedAdvisor = membership?.advisor_username || '';
      if (!assignedAdvisor || assignedAdvisor.toLowerCase() !== requestedAdvisor.toLowerCase()) {
        throw HttpError.forbidden(FORBIDDEN_ADVISOR_MSG);
      }
    }

    if (!membership || !membership.advisor_username) {
      throw HttpError.badRequest('An academic advisor has not been assigned to your group yet');
    }

    const saved = await messagesRepository.addDirectMessage({
      studentUsername: cleanStudent,
      advisorUsername: membership.advisor_username,
      groupId: membership.group_id,
      senderUsername: cleanStudent,
      content: cleanContent,
    });

    await presenceService.touchUserPresence(cleanStudent, true);

    return formatDirectMessage(saved, cleanStudent);
  }

  /**
   * US26 / US27: Send plain-text reply from advisor to a student in their assigned group.
   */
  async sendAdvisorMessage(advisorUsername, role, studentUsername, { content } = {}) {
    const cleanContent = this.normalizeContent(content, 'Message');
    const membership = await this.assertAdvisorOwnsStudent(advisorUsername, role, studentUsername);

    const cleanAdvisor = String(advisorUsername).trim();
    const cleanStudent = String(studentUsername).trim();

    const saved = await messagesRepository.addDirectMessage({
      studentUsername: cleanStudent,
      advisorUsername: cleanAdvisor,
      groupId: membership.group_id,
      senderUsername: cleanAdvisor,
      content: cleanContent,
    });

    await presenceService.touchUserPresence(cleanAdvisor, true);

    return formatDirectMessage(saved, cleanAdvisor);
  }

  /**
   * US27: Advisor Inbox — list all assigned groups & students with unread counters,
   * read-only academic snapshots, and default sort by newest unread messages first.
   */
  async getAdvisorInbox(advisorUsername, role) {
    if (!advisorUsername) {
      throw HttpError.unauthorized('not authenticated');
    }
    if (role !== 'Advisor') {
      throw HttpError.forbidden('Only advisors can access the advisor inbox');
    }

    const cleanAdvisor = String(advisorUsername).trim();
    const advisorLower = cleanAdvisor.toLowerCase();

    await presenceService.touchUserPresence(cleanAdvisor, true);

    const allGroups = await groupRepository.listGroups();
    const assignedGroups = (allGroups || []).filter(
      (g) => String(g.advisor_username || '').trim().toLowerCase() === advisorLower
    );

    if (assignedGroups.length === 0) {
      return {
        groups: [],
        students: [],
        totalUnread: 0,
      };
    }

    const membersByGroup = await Promise.all(
      assignedGroups.map(async (g) => ({
        group: g,
        members: await groupRepository.listGroupMembers(g.id),
      }))
    );

    const allStudentsFlat = [];
    for (const { group, members } of membersByGroup) {
      for (const m of members || []) {
        allStudentsFlat.push({
          username: m.username,
          display_name: m.display_name || null,
          avatar_url: m.avatar_url || null,
          enrolledAt: m.enrolled_at ? new Date(m.enrolled_at).toISOString() : null,
          groupId: group.id,
          groupName: group.name,
          program: group.program,
          studyYear: group.study_year,
        });
      }
    }

    const studentUsernames = allStudentsFlat.map((s) => s.username);
    const [advisorMessages, rawAcademicData] = await Promise.all([
      messagesRepository.listMessagesForAdvisor(cleanAdvisor),
      messagesRepository.getStudentsAcademicRawData(studentUsernames),
    ]);

    // Aggregate messages per student (advisorMessages are ordered ASC by created_at)
    const msgStatsByStudent = new Map();
    for (const msg of advisorMessages || []) {
      const sKey = String(msg.student_username || '').trim().toLowerCase();
      if (!sKey) continue;
      const stats = msgStatsByStudent.get(sKey) || {
        unreadCount: 0,
        lastUnreadAt: null,
        lastMessage: null,
      };

      const isFromStudent = String(msg.sender_username || '').trim().toLowerCase() !== advisorLower;
      const msgIso = msg.created_at ? new Date(msg.created_at).toISOString() : new Date().toISOString();

      if (isFromStudent && !msg.is_read) {
        stats.unreadCount += 1;
        stats.lastUnreadAt = msgIso;
      }

      stats.lastMessage = {
        id: Number(msg.id),
        senderUsername: msg.sender_username,
        isMine: !isFromStudent,
        preview: truncatePreview(msg.content, 80),
        createdAt: msgIso,
      };

      msgStatsByStudent.set(sKey, stats);
    }

    const unreadByGroupId = new Map();
    let totalUnread = 0;

    const students = allStudentsFlat.map((s) => {
      const sKey = s.username.toLowerCase();
      const stats = msgStatsByStudent.get(sKey) || {
        unreadCount: 0,
        lastUnreadAt: null,
        lastMessage: null,
      };

      totalUnread += stats.unreadCount;
      unreadByGroupId.set(s.groupId, (unreadByGroupId.get(s.groupId) || 0) + stats.unreadCount);

      return {
        ...s,
        unreadCount: stats.unreadCount,
        lastUnreadAt: stats.lastUnreadAt,
        lastMessage: stats.lastMessage,
        academicSnapshot: this.computeAcademicSnapshot(s.username, rawAcademicData),
      };
    });

    // Default sort (US27 Scenario 1):
    // 1. Students with unread messages > 0, ordered by newest unread message DESC
    // 2. Students with conversation history, ordered by last message DESC
    // 3. Alphabetically by display_name / username
    students.sort((a, b) => {
      if ((a.unreadCount > 0) !== (b.unreadCount > 0)) {
        return a.unreadCount > 0 ? -1 : 1;
      }
      if (a.unreadCount > 0 && b.unreadCount > 0) {
        const diff = new Date(b.lastUnreadAt).getTime() - new Date(a.lastUnreadAt).getTime();
        if (diff !== 0) return diff;
      }
      if (a.lastMessage && b.lastMessage) {
        const diff = new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime();
        if (diff !== 0) return diff;
      } else if (a.lastMessage !== b.lastMessage) {
        return a.lastMessage ? -1 : 1;
      }
      const nameA = (a.display_name || a.username || '').toLowerCase();
      const nameB = (b.display_name || b.username || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    const groups = assignedGroups.map((g) => ({
      id: g.id,
      name: g.name,
      program: g.program,
      study_year: g.study_year,
      memberCount: Number(g.member_count) || 0,
      unreadCount: unreadByGroupId.get(g.id) || 0,
    }));

    return {
      groups,
      students,
      totalUnread,
    };
  }

  async assertAdvisorOwnsGroup(advisorUsername, role, groupId) {
    if (!advisorUsername) {
      throw HttpError.unauthorized('not authenticated');
    }
    if (role !== 'Advisor') {
      throw HttpError.forbidden('Only advisors can manage group announcements');
    }

    const numericGroupId = Number(groupId);
    if (!Number.isInteger(numericGroupId) || numericGroupId <= 0) {
      throw HttpError.badRequest('Invalid group ID');
    }

    const group = await groupRepository.findGroupById(numericGroupId);
    if (!group) {
      throw HttpError.notFound('Group not found');
    }

    if (
      !group.advisor_username ||
      group.advisor_username.trim().toLowerCase() !== String(advisorUsername).trim().toLowerCase()
    ) {
      throw HttpError.forbidden('Access denied: you are not assigned to this group');
    }

    return group;
  }

  /**
   * US27: Open a specific student thread as Advisor, enforce assigned-group ACL,
   * reset unread counter to 0 immediately, and return dialog + read-only snapshot.
   */
  async getAdvisorStudentThread(advisorUsername, role, studentUsername) {
    const membership = await this.assertAdvisorOwnsStudent(advisorUsername, role, studentUsername);

    const cleanAdvisor = String(advisorUsername).trim();
    const cleanStudent = String(studentUsername).trim();

    await Promise.all([
      messagesRepository.markDialogRead(cleanStudent, cleanAdvisor, cleanAdvisor),
      presenceService.touchUserPresence(cleanAdvisor, true),
    ]);

    const [rows, studentProfile, rawAcademicData, studentPresence] = await Promise.all([
      messagesRepository.getDialogMessages(cleanStudent, cleanAdvisor),
      userRepository.getProfile(cleanStudent),
      messagesRepository.getStudentsAcademicRawData([cleanStudent]),
      presenceService.getPresenceForUsername(cleanStudent),
    ]);

    return {
      student: {
        username: cleanStudent,
        display_name: studentProfile?.display_name || null,
        avatar_url: studentProfile?.avatar_url || null,
        groupId: membership.group_id,
        groupName: membership.group_name,
        program: membership.program,
        studyYear: membership.study_year,
        presence: studentPresence,
      },
      unreadCount: 0,
      academicSnapshot: this.computeAcademicSnapshot(cleanStudent, rawAcademicData),
      messages: rows.map((r) => formatDirectMessage(r, cleanAdvisor)),
    };
  }

  /**
   * US29: Broadcast a plain-text announcement (<= 2000 chars) to all current members
   * of an advisor's assigned group.
   */
  async sendGroupAnnouncement(advisorUsername, role, groupId, { content } = {}) {
    const cleanContent = this.normalizeContent(content, 'Announcement');
    const group = await this.assertAdvisorOwnsGroup(advisorUsername, role, groupId);
    const cleanAdvisor = String(advisorUsername).trim();

    const members = await groupRepository.listGroupMembers(group.id);
    const recipientUsernames = Array.from(
      new Set((members || []).map((m) => String(m.username || '').trim()).filter(Boolean))
    );

    const saved = await messagesRepository.createAnnouncement({
      groupId: group.id,
      advisorUsername: cleanAdvisor,
      content: cleanContent,
      recipientUsernames,
    });

    await presenceService.touchUserPresence(cleanAdvisor, true);

    return {
      id: Number(saved.id),
      type: 'announcement',
      badge: 'Announcement',
      groupId: group.id,
      groupName: group.name,
      advisorUsername: cleanAdvisor,
      advisorDisplayName: group.advisor_display_name || cleanAdvisor,
      content: saved.content,
      deliveredCount: recipientUsernames.length,
      readCount: 0,
      unreadCount: recipientUsernames.length,
      readers: [],
      createdAt: saved.created_at ? new Date(saved.created_at).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * US29: List announcements for an advisor's group with delivery & read counters.
   */
  async getGroupAnnouncementsForAdvisor(advisorUsername, role, groupId) {
    const group = await this.assertAdvisorOwnsGroup(advisorUsername, role, groupId);
    const cleanAdvisor = String(advisorUsername).trim();

    await presenceService.touchUserPresence(cleanAdvisor, true);

    const rows = await messagesRepository.listGroupAnnouncements(group.id);
    const reads = await messagesRepository.listReadsForAnnouncements(rows.map((r) => r.id));

    const readsByAnnId = new Map();
    for (const r of reads || []) {
      const aid = Number(r.announcement_id);
      const arr = readsByAnnId.get(aid) || [];
      arr.push(r);
      readsByAnnId.set(aid, arr);
    }

    const announcements = (rows || []).map((row) => {
      const recipients = Array.isArray(row.recipient_usernames) ? row.recipient_usernames : [];
      const recipientSet = new Set(recipients.map((u) => String(u || '').trim().toLowerCase()).filter(Boolean));
      const rawReads = readsByAnnId.get(Number(row.id)) || [];

      const seenReaderSet = new Set();
      const validReaders = [];
      for (const rd of rawReads) {
        const uLower = String(rd.student_username || '').trim().toLowerCase();
        if (!uLower || !recipientSet.has(uLower) || seenReaderSet.has(uLower)) continue;
        seenReaderSet.add(uLower);
        validReaders.push({
          username: rd.student_username,
          readAt: rd.read_at ? new Date(rd.read_at).toISOString() : null,
        });
      }

      const deliveredCount = recipientSet.size;
      const readCount = validReaders.length;

      return {
        id: Number(row.id),
        type: 'announcement',
        badge: 'Announcement',
        groupId: group.id,
        groupName: group.name,
        advisorUsername: row.advisor_username,
        advisorDisplayName: group.advisor_display_name || row.advisor_username,
        content: row.content,
        deliveredCount,
        readCount,
        unreadCount: Math.max(0, deliveredCount - readCount),
        readers: validReaders,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      };
    });

    return {
      group: {
        id: group.id,
        name: group.name,
        program: group.program,
        study_year: group.study_year,
      },
      announcements,
    };
  }

  /**
   * US29: List announcements for a student's active group channel.
   * Departed/removed students never receive announcements.
   */
  async getStudentAnnouncements(studentUsername, { markAsRead = false } = {}) {
    if (!studentUsername) {
      throw HttpError.unauthorized('not authenticated');
    }
    const cleanStudent = String(studentUsername).trim();
    const studentLower = cleanStudent.toLowerCase();

    await presenceService.touchUserPresence(cleanStudent, true);

    const membership = await groupRepository.getStudentGroupAndAdvisor(cleanStudent);
    if (!membership) {
      return {
        group: null,
        advisor: null,
        unreadCount: 0,
        announcements: [],
      };
    }

    const rows = await messagesRepository.listGroupAnnouncements(membership.group_id);
    const eligibleRows = (rows || []).filter((row) => {
      const recipients = Array.isArray(row.recipient_usernames) ? row.recipient_usernames : [];
      return recipients.some((u) => String(u || '').trim().toLowerCase() === studentLower);
    });

    const reads = await messagesRepository.listReadsForAnnouncements(eligibleRows.map((r) => r.id));
    const myReadMap = new Map();
    for (const rd of reads || []) {
      if (String(rd.student_username || '').trim().toLowerCase() === studentLower) {
        myReadMap.set(Number(rd.announcement_id), rd.read_at ? new Date(rd.read_at).toISOString() : new Date().toISOString());
      }
    }

    const unreadIds = eligibleRows
      .filter((row) => !myReadMap.has(Number(row.id)))
      .map((row) => Number(row.id));

    if (markAsRead && unreadIds.length > 0) {
      await messagesRepository.markAnnouncementsRead(unreadIds, cleanStudent);
      const nowIso = new Date().toISOString();
      for (const id of unreadIds) {
        myReadMap.set(id, nowIso);
      }
    }

    const advisorNameByUser = new Map();
    if (membership.advisor_username) {
      advisorNameByUser.set(
        membership.advisor_username.toLowerCase(),
        membership.advisor_display_name || membership.advisor_username
      );
    }

    const announcements = eligibleRows.map((row) => {
      const readAt = myReadMap.get(Number(row.id)) || null;
      return {
        id: Number(row.id),
        type: 'announcement',
        badge: 'Announcement',
        groupId: membership.group_id,
        groupName: membership.group_name,
        advisorUsername: row.advisor_username,
        advisorDisplayName:
          advisorNameByUser.get(String(row.advisor_username || '').toLowerCase()) || row.advisor_username,
        content: row.content,
        isRead: Boolean(readAt),
        readAt,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      };
    });

    const unreadCount = announcements.filter((a) => !a.isRead).length;

    return {
      group: {
        id: membership.group_id,
        name: membership.group_name,
        program: membership.program,
        study_year: membership.study_year,
      },
      advisor: membership.advisor_username
        ? {
            username: membership.advisor_username,
            display_name: membership.advisor_display_name,
            avatar_url: membership.advisor_avatar_url,
          }
        : null,
      unreadCount,
      announcements,
    };
  }

  async markStudentAnnouncementsRead(studentUsername) {
    return this.getStudentAnnouncements(studentUsername, { markAsRead: true });
  }

  /**
   * US28 + US30: Lightweight incremental sync endpoint.
   * Updates caller's online presence, returns unread counters, and (when `since` is given)
   * returns privacy-safe truncated previews (<= 75 chars) excluding caller's own messages.
   */
  async syncForUser(username, role, sinceIso = null) {
    if (!username) {
      throw HttpError.unauthorized('not authenticated');
    }

    const cleanUser = String(username).trim();
    const userLower = cleanUser.toLowerCase();
    const serverTime = new Date().toISOString();

    await presenceService.touchUserPresence(cleanUser, true);

    let sinceMs = null;
    if (sinceIso) {
      const parsed = new Date(sinceIso);
      if (!Number.isNaN(parsed.getTime())) {
        sinceMs = parsed.getTime();
      }
    }

    if (role === 'Advisor') {
      const [allGroups, unreadRows] = await Promise.all([
        groupRepository.listGroups(),
        messagesRepository.listUnreadDirectForUser(cleanUser, 'Advisor'),
      ]);

      const assignedGroups = (allGroups || []).filter(
        (g) => String(g.advisor_username || '').trim().toLowerCase() === userLower
      );

      const studentMetaByUser = new Map();
      await Promise.all(
        assignedGroups.map(async (g) => {
          const members = await groupRepository.listGroupMembers(g.id);
          for (const m of members || []) {
            studentMetaByUser.set(String(m.username || '').trim().toLowerCase(), {
              displayName: m.display_name || m.username,
              groupName: g.name,
            });
          }
        })
      );

      const scopedUnread = (unreadRows || []).filter((m) => {
        const senderLower = String(m.sender_username || '').trim().toLowerCase();
        const studentLower = String(m.student_username || '').trim().toLowerCase();
        return senderLower !== userLower && studentMetaByUser.has(studentLower);
      });

      const notifications =
        sinceMs === null
          ? []
          : scopedUnread
              .filter((m) => new Date(m.created_at).getTime() > sinceMs)
              .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
              .map((m) => {
                const meta = studentMetaByUser.get(String(m.student_username || '').trim().toLowerCase());
                return {
                  id: `direct-${m.id}`,
                  messageId: Number(m.id),
                  kind: 'direct',
                  badge: null,
                  senderUsername: m.sender_username,
                  senderName: meta?.displayName || m.sender_username,
                  groupName: meta?.groupName || null,
                  preview: truncatePreview(m.content, 75),
                  createdAt: new Date(m.created_at).toISOString(),
                };
              });

      return {
        serverTime,
        unreadDirect: scopedUnread.length,
        unreadAnnouncements: 0,
        unreadTotal: scopedUnread.length,
        notifications,
      };
    }

    if (role !== 'Student') {
      return {
        serverTime,
        unreadDirect: 0,
        unreadAnnouncements: 0,
        unreadTotal: 0,
        notifications: [],
      };
    }

    const [membership, unreadDirectRows] = await Promise.all([
      groupRepository.getStudentGroupAndAdvisor(cleanUser),
      messagesRepository.listUnreadDirectForUser(cleanUser, 'Student'),
    ]);

    const assignedAdvisorLower = String(membership?.advisor_username || '').trim().toLowerCase();
    const advisorDisplayName = membership?.advisor_display_name || membership?.advisor_username || 'Advisor';

    const scopedDirect = (unreadDirectRows || []).filter((m) => {
      const senderLower = String(m.sender_username || '').trim().toLowerCase();
      return (
        senderLower !== userLower &&
        Boolean(assignedAdvisorLower) &&
        String(m.advisor_username || '').trim().toLowerCase() === assignedAdvisorLower
      );
    });

    let unreadAnnRows = [];
    if (membership?.group_id) {
      const annRows = await messagesRepository.listGroupAnnouncements(membership.group_id);
      const eligibleAnns = (annRows || []).filter((row) => {
        const recipients = Array.isArray(row.recipient_usernames) ? row.recipient_usernames : [];
        const senderLower = String(row.advisor_username || '').trim().toLowerCase();
        return (
          senderLower !== userLower &&
          recipients.some((u) => String(u || '').trim().toLowerCase() === userLower)
        );
      });

      const reads = await messagesRepository.listReadsForAnnouncements(eligibleAnns.map((r) => r.id));
      const readSet = new Set(
        (reads || [])
          .filter((rd) => String(rd.student_username || '').trim().toLowerCase() === userLower)
          .map((rd) => Number(rd.announcement_id))
      );

      unreadAnnRows = eligibleAnns.filter((row) => !readSet.has(Number(row.id)));
    }

    let notifications = [];
    if (sinceMs !== null) {
      const directNotifs = scopedDirect
        .filter((m) => new Date(m.created_at).getTime() > sinceMs)
        .map((m) => ({
          id: `direct-${m.id}`,
          messageId: Number(m.id),
          kind: 'direct',
          badge: null,
          senderUsername: m.sender_username,
          senderName: advisorDisplayName,
          groupName: membership?.group_name || null,
          preview: truncatePreview(m.content, 75),
          createdAt: new Date(m.created_at).toISOString(),
        }));

      const annNotifs = unreadAnnRows
        .filter((a) => new Date(a.created_at).getTime() > sinceMs)
        .map((a) => ({
          id: `announcement-${a.id}`,
          announcementId: Number(a.id),
          kind: 'announcement',
          badge: 'Announcement',
          senderUsername: a.advisor_username,
          senderName: advisorDisplayName,
          groupName: membership?.group_name || null,
          preview: truncatePreview(a.content, 75),
          createdAt: new Date(a.created_at).toISOString(),
        }));

      notifications = [...directNotifs, ...annNotifs].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    }

    const unreadDirect = scopedDirect.length;
    const unreadAnnouncements = unreadAnnRows.length;

    return {
      serverTime,
      unreadDirect,
      unreadAnnouncements,
      unreadTotal: unreadDirect + unreadAnnouncements,
      notifications,
    };
  }
}

export const messagesService = new MessagesService();
