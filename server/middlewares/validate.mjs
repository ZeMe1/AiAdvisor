import { HttpError } from '../errors/http-error.mjs';

/**
 * Валидатор тела запроса (req.body) через Zod
 */
export const validateBody = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) {
    const message = (result.error.issues || []).map((e) => e.message).join(', ');
    return next(HttpError.badRequest(message));
  }
  req.body = result.data;
  next();
};

/**
 * Валидатор параметров строки запроса (req.query) через Zod
 */
export const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query ?? {});
  if (!result.success) {
    const message = (result.error.issues || []).map((e) => e.message).join(', ');
    return next(HttpError.badRequest(message));
  }
  req.query = result.data;
  next();
};

/**
 * Валидатор параметров пути (req.params) через Zod
 */
export const validateParams = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.params ?? {});
  if (!result.success) {
    const message = (result.error.issues || []).map((e) => e.message).join(', ');
    return next(HttpError.badRequest(message));
  }
  req.params = result.data;
  next();
};
