import { SduClient } from '../../src/sdu/client.js';
import { userRepository } from '../repositories/user.repository.mjs';
import { sessionRepository } from '../repositories/session.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export class AuthService {
  async login(username, password) {
    const client = new SduClient();
    const r = await client.login(String(username), String(password));
    if (!r.ok) {
      throw HttpError.unauthorized('Неверный логин или пароль');
    }

    // Поиск/создание локального пользователя в БД (пароль портала НЕ сохраняется!)
    let user = await userRepository.findByUsername(username);
    if (!user) {
      user = await userRepository.findOrCreateUser(username);
    } else if (user.is_blocked) {
      throw HttpError.forbidden('Ваш аккаунт заблокирован');
    }

    const sessionStatus = r.needs2fa ? 'pending_2fa' : 'authed';
    const sessionId = await sessionRepository.createSession({
      userId: user.id,
      username: user.username,
      role: user.role,
      status: sessionStatus,
      sduJar: client.jarAsObject(),
    });

    return {
      sessionId,
      status: r.needs2fa ? '2fa_required' : 'ok',
      role: user.role,
    };
  }

  async submit2fa(client, sessionId, code) {
    if (!client || client.status !== 'pending_2fa' || !sessionId) {
      throw HttpError.badRequest('2fa не ожидается');
    }

    const r = await client.submit2fa(String(code));
    if (!r.ok) {
      throw HttpError.unauthorized('Код не принят — он неверный или истёк. Выйдите и войдите заново: придёт новый код');
    }

    await sessionRepository.updateSession(sessionId, {
      status: 'authed',
      sduJar: client.jarAsObject(),
    });

    return { status: 'ok' };
  }

  async logout(client, sessionId) {
    if (client) {
      await client.logout().catch(() => {});
    }
    if (sessionId) {
      await sessionRepository.deleteSession(sessionId).catch(() => {});
    }
    return { status: 'ok' };
  }
}

export const authService = new AuthService();
