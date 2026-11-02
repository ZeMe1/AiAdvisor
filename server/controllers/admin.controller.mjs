import { userService } from '../services/user.service.mjs';
import { groupService } from '../services/group.service.mjs';
import { curriculumService } from '../services/curriculum.service.mjs';

export class AdminController {
  async listUsers(req, res) {
    const users = await userService.listAllUsers();
    res.json(users);
  }

  async updateRole(req, res) {
    const { username } = req.params;
    const { role } = req.body;
    const updated = await userService.updateUserRole(username, role);
    res.json(updated);
  }

  async blockUser(req, res) {
    const { username } = req.params;
    const { is_blocked } = req.body;
    const updated = await userService.setUserBlocked(username, is_blocked);
    res.json(updated);
  }

  // --- Group & Advisor Management (US13) ---
  async listGroups(req, res) {
    const groups = await groupService.listGroups();
    res.json(groups);
  }

  async createGroup(req, res) {
    const group = await groupService.createGroup(req.body);
    res.status(201).json(group);
  }

  async assignAdvisor(req, res) {
    const groupId = parseInt(req.params.id, 10);
    const { advisor_username } = req.body;
    const updated = await groupService.assignAdvisor(groupId, advisor_username);
    res.json(updated);
  }

  async listGroupMembers(req, res) {
    const groupId = parseInt(req.params.id, 10);
    const members = await groupService.listGroupMembers(groupId);
    res.json(members);
  }

  async enrollStudent(req, res) {
    const groupId = parseInt(req.params.id, 10);
    const { username } = req.body;
    const members = await groupService.enrollStudent(groupId, username);
    res.json(members);
  }

  async removeStudent(req, res) {
    const groupId = parseInt(req.params.id, 10);
    const { username } = req.params;
    const members = await groupService.removeStudent(groupId, username);
    res.json(members);
  }

  async deleteGroup(req, res) {
    const groupId = parseInt(req.params.id, 10);
    const deleted = await groupService.deleteGroup(groupId);
    res.json({ success: true, group: deleted });
  }

  // --- Curriculum Management (US14) ---
  async listCurriculums(req, res) {
    const list = await curriculumService.listCurriculums();
    res.json(list);
  }

  async previewCurriculum(req, res) {
    const preview = await curriculumService.previewCurriculum(req.body);
    res.json(preview);
  }

  async importCurriculum(req, res) {
    const result = await curriculumService.importCurriculum(req.body);
    res.status(201).json(result);
  }

  async getCurriculum(req, res) {
    const id = parseInt(req.params.id, 10);
    const curr = await curriculumService.getCurriculumDetails(id);
    res.json(curr);
  }

  async setCurriculumPublished(req, res) {
    const id = parseInt(req.params.id, 10);
    const { is_published } = req.body;
    const updated = await curriculumService.setPublished(id, Boolean(is_published));
    res.json(updated);
  }

  async deleteCurriculum(req, res) {
    const id = parseInt(req.params.id, 10);
    const result = await curriculumService.deleteCurriculum(id);
    res.json(result);
  }

  async listCurriculumStudents(req, res) {
    const id = parseInt(req.params.id, 10);
    const list = await curriculumService.listAssignedStudents(id);
    res.json(list);
  }

  async assignCurriculumStudent(req, res) {
    const id = parseInt(req.params.id, 10);
    const { username } = req.body;
    const list = await curriculumService.assignStudent(id, username);
    res.json(list);
  }

  async removeCurriculumStudent(req, res) {
    const id = parseInt(req.params.id, 10);
    const { username } = req.params;
    const list = await curriculumService.removeStudent(id, username);
    res.json(list);
  }
}

export const adminController = new AdminController();
