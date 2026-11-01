import { userRepository } from '../repositories/user.repository.mjs';
import { sessionRepository } from '../repositories/session.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class UserService {
  async getProfile(username) {
    if (!username) throw HttpError.unauthorized('Local user not found');
    const profile = await userRepository.getProfile(username);
    if (!profile) throw HttpError.notFound('Profile not found');
    return profile;
  }

  async updateProfile(username, { display_name, avatar_url }) {
    if (!username) throw HttpError.unauthorized('Local user not found');
    const updated = await userRepository.updateProfile(username, { display_name, avatar_url });
    if (!updated) throw HttpError.notFound('User not found');
    return updated;
  }

  async listAllUsers() {
    return userRepository.listAllUsers();
  }

  async updateUserRole(username, role) {
    const updated = await userRepository.updateRole(username, role);
    if (!updated) throw HttpError.notFound('User not found');
    return updated;
  }

  async setUserBlocked(username, is_blocked) {
    const updated = await userRepository.setBlocked(username, is_blocked);
    if (!updated) throw HttpError.notFound('User not found');

    if (is_blocked) {
      await sessionRepository.deleteUserSessions(username).catch(() => {});
    }

    return updated;
  }
}

export const userService = new UserService();
