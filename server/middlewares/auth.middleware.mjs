import { HttpError } from '../errors/http-error.mjs';

const DEMO = process.env.DEMO === '1';

/**
 * Проверяет, что пользователь авторизован в системе
 */
export function requireAuth(req, res, next) {
  if (DEMO) return next ? next() : undefined;
  if (!req.client || req.client.status !== 'authed') {
    const err = HttpError.unauthorized('not authenticated');
    if (next) return next(err);
    throw err;
  }
  if (next) return next();
  return req.client;
}

/**
 * Проверяет, что пользователь имеет роль Administrator
 */
export function requireAdmin(req, res, next) {
  const client = requireAuth(req);
  if (DEMO) return next ? next() : undefined;
  if (client.localRole !== 'Administrator') {
    const err = HttpError.forbidden('Доступ запрещен. Требуются права администратора.');
    if (next) return next(err);
    throw err;
  }
  if (next) return next();
  return client;
}
