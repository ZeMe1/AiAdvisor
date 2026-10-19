import { SduClient } from '../../src/sdu/client.js';
import { sessionRepository } from '../repositories/session.repository.mjs';

const COOKIE = 'zeme_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 дней

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, sessionId) {
  const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  const secure = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secure}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * Middleware загрузки и привязки сессии пользователя
 */
export async function sessionMiddleware(req, res, next) {
  try {
    const sessionId = parseCookies(req)[COOKIE];
    if (!sessionId) {
      req.client = null;
      req.session = null;
      return next();
    }

    const session = await sessionRepository.getSession(sessionId);
    if (!session) {
      req.client = null;
      req.session = null;
      return next();
    }

    const client = new SduClient();
    client.status = session.status;
    client.localUsername = session.username;
    client.localRole = session.role;
    client.userId = session.user_id;

    if (session.sdu_jar && typeof session.sdu_jar === 'object') {
      for (const [k, v] of Object.entries(session.sdu_jar)) {
        if (typeof v === 'string') client.jar.set(k, v);
      }
    }

    // Автоматическое сохранение обновлений cookie-jar SDU в БД
    client.onJarChange = (jar) => {
      sessionRepository.updateSession(session.id, { sduJar: Object.fromEntries(jar) }).catch(console.error);
    };

    req.sessionId = session.id;
    req.session = session;
    req.client = client;
    next();
  } catch (err) {
    console.error('[session middleware]', err);
    next();
  }
}
