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

  async listGroupMembers(groupId) {
    const group = await groupRepository.findGroupById(groupId);
    if (!group) throw HttpError.notFound('Group not found');
    return groupRepository.listGroupMembers(groupId);
  }

  async enrollStudent(groupId, username) {
    const group = await groupRepository.findGroupById(groupId);
    if (!group) throw HttpError.notFound('Group not found');

    const cleanUsername = String(username).trim();
    if (!cleanUsername) throw HttpError.badRequest('Username cannot be empty');

    await userRepository.findOrCreateUser(cleanUsername);
    await groupRepository.enrollStudent(groupId, cleanUsername);
    return groupRepository.listGroupMembers(groupId);
  }

  async removeStudent(groupId, username) {
    const group = await groupRepository.findGroupById(groupId);
    if (!group) throw HttpError.notFound('Group not found');

    await groupRepository.removeStudent(groupId, String(username).trim());
    return groupRepository.listGroupMembers(groupId);
  }
}

export const groupService = new GroupService();
