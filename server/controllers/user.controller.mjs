import { userService } from '../services/user.service.mjs';
import { groupService } from '../services/group.service.mjs';

export class UserController {
  async getProfile(req, res) {
    const profile = await userService.getProfile(req.client.localUsername);
    res.json(profile);
  }

  async updateProfile(req, res) {
    const updated = await userService.updateProfile(req.client.localUsername, req.body);
    res.json(updated);
  }

  async getMyAdvisor(req, res) {
    const result = await groupService.getStudentAdvisor(req.client.localUsername);
    res.json(result);
  }
}

export const userController = new UserController();
