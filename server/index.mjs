/**
 * ZeMe / AiAdvisor — планировщик расписания SDU.
 * Чистая многослойная архитектура (Express 5 API + статика).
 */

import path from 'node:path';
import express from 'express';
import { initDb } from './db.mjs';
import { sessionMiddleware } from './middlewares/session.middleware.mjs';
import { errorHandler } from './middlewares/error.middleware.mjs';

import authRoutes from './routes/auth.routes.mjs';
import scheduleRoutes from './routes/schedule.routes.mjs';
import userRoutes from './routes/user.routes.mjs';
import adminRoutes from './routes/admin.routes.mjs';
import studentRoutes from './routes/student.routes.mjs';

// Инициализация структуры БД
initDb().catch(console.error);

const PORT = Number(process.env.PORT || 3001);
const DEMO = process.env.DEMO === '1';

const app = express();

// ------------------------------------------------- Базовые middleware
app.use(express.json({ limit: '15mb' }));
app.use(sessionMiddleware);

// ------------------------------------------------- API Маршруты
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', scheduleRoutes);
app.use('/api', userRoutes);
app.use('/api', studentRoutes);

// ------------------------------------------------- Статика фронтенда
const webDist = path.resolve('web/dist');
app.use(express.static(webDist));
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(webDist, 'index.html'));
});

// ------------------------------------------------- Централизованный обработчик ошибок
app.use(errorHandler);

if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`ZeMe server: http://localhost:${PORT} (${DEMO ? 'DEMO' : 'live: my.sdu.edu.kz'})`);
  });
}

export { app };
