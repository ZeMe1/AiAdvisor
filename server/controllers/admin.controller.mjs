import { userService } from '../services/user.service.mjs';
import { groupService } from '../services/group.service.mjs';

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

  async previewImport(req, res) {
    const { csvContent } = req.body;
    const preview = groupService.parseCsv(csvContent);
    res.json(preview);
  }

  async executeImport(req, res) {
    const { rows } = req.body;
    const result = await groupService.executeImport(rows);
    res.json(result);
  }
}

export const adminController = new AdminController();
