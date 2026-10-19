import { userRepository } from '../repositories/user.repository.mjs';
import { sessionRepository } from '../repositories/session.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class UserService {
  async getProfile(username) {
    if (!username) throw HttpError.unauthorized('Не найден локальный пользователь');
    const profile = await userRepository.getProfile(username);
    if (!profile) throw HttpError.notFound('Профиль не найден');
    return profile;
  }

  async updateProfile(username, { display_name, avatar_url }) {
    if (!username) throw HttpError.unauthorized('Не найден локальный пользователь');
    const updated = await userRepository.updateProfile(username, { display_name, avatar_url });
    if (!updated) throw HttpError.notFound('Пользователь не найден');
    return updated;
  }

  async listAllUsers() {
    return userRepository.listAllUsers();
  }

  async updateUserRole(username, role) {
    const updated = await userRepository.updateRole(username, role);
    if (!updated) throw HttpError.notFound('Пользователь не найден');
    return updated;
  }

  async setUserBlocked(username, is_blocked) {
    const updated = await userRepository.setBlocked(username, is_blocked);
    if (!updated) throw HttpError.notFound('Пользователь не найден');

    if (is_blocked) {
      await sessionRepository.deleteUserSessions(username).catch(() => {});
    }

    return updated;
  }
}

export const userService = new UserService();
