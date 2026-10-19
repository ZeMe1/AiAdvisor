import { userService } from '../services/user.service.mjs';

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
}

export const adminController = new AdminController();
