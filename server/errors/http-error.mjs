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

  static badRequest(message = 'Неверный запрос') {
    return new HttpError(400, message);
  }

  static unauthorized(message = 'not authenticated') {
    return new HttpError(401, message);
  }

  static sessionExpired(message = 'Сессия портала истекла — войдите заново') {
    return new HttpError(401, message, { sessionExpired: true });
  }

  static forbidden(message = 'Доступ запрещен') {
    return new HttpError(403, message);
  }

  static notFound(message = 'Ресурс не найден') {
    return new HttpError(404, message);
  }

  static badGateway(message = 'Ошибка взаимодействия с внешним сервисом') {
    return new HttpError(502, message);
  }
}
