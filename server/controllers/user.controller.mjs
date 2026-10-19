import { userService } from '../services/user.service.mjs';

export class UserController {
  async getProfile(req, res) {
    const profile = await userService.getProfile(req.client.localUsername);
    res.json(profile);
  }

  async updateProfile(req, res) {
    const updated = await userService.updateProfile(req.client.localUsername, req.body);
    res.json(updated);
  }
}

export const userController = new UserController();
