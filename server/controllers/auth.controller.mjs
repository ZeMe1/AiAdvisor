import { authService } from '../services/auth.service.mjs';
import { setSessionCookie, clearSessionCookie } from '../middlewares/session.middleware.mjs';

export class AuthController {
  async login(req, res) {
    const { username, password } = req.body;
    const result = await authService.login(username, password);
    setSessionCookie(res, result.sessionId);
    res.json({ status: result.status, role: result.role });
  }

  async twoFa(req, res) {
    const { code } = req.body;
    const result = await authService.submit2fa(req.client, req.sessionId, code);
    res.json(result);
  }

  async logout(req, res) {
    await authService.logout(req.client, req.sessionId);
    clearSessionCookie(res);
    res.json({ status: 'ok' });
  }
}

export const authController = new AuthController();
