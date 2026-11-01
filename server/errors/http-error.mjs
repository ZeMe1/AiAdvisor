/**
 * Стандартизированный класс HTTP-ошибок приложения
 */
export class HttpError extends Error {
  constructor(status, message, { sessionExpired = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.sessionExpired = sessionExpired;
  }

  static badRequest(message = 'Bad request') {
    return new HttpError(400, message);
  }

  static unauthorized(message = 'not authenticated') {
    return new HttpError(401, message);
  }

  static sessionExpired(message = 'Portal session expired — please log in again') {
    return new HttpError(401, message, { sessionExpired: true });
  }

  static forbidden(message = 'Access denied') {
    return new HttpError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new HttpError(404, message);
  }

  static badGateway(message = 'Upstream service error') {
    return new HttpError(502, message);
  }
}
