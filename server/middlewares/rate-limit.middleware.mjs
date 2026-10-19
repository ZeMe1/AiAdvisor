const authHits = new Map();

/**
 * Лёгкий rate-limit на auth-эндпоинты: 30 запросов / минуту / IP
 */
export function authRateLimit(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'default-ip';
  const now = Date.now();
  const window = (authHits.get(ip) || []).filter((t) => now - t < 60_000);

  if (window.length >= 30) {
    return res.status(429).json({ error: 'слишком много попыток, подождите минуту' });
  }

  window.push(now);
  authHits.set(ip, window);
  next();
}
