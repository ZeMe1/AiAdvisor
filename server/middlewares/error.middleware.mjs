import { HttpError } from '../errors/http-error.mjs';
import { clearSessionCookie } from './session.middleware.mjs';
import { sessionRepository } from '../repositories/session.repository.mjs';

/**
 * Обертка для асинхронных контроллеров Express
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Централизованный обработчик ошибок Express
 */
export async function errorHandler(err, req, res, _next) {
  const isSessionExpired = err.sessionExpired === true;
  if (isSessionExpired) {
    console.warn(`[sdu session warning] Upstream SDU session expired for ${req.session?.username || 'user'}. Preserving local session.`);
  }

  const status = isSessionExpired ? 401 : (err instanceof HttpError ? err.status : (err.status || 500));
  if (status >= 500) {
    console.error(`[api error] ${req.method} ${req.path}:`, err.message || err);
  }

  res.status(status).json({
    error: err.message || 'internal error',
    ...(isSessionExpired ? { sessionExpired: true } : {}),
  });
}
