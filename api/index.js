/**
 * Vercel serverless entrypoint: монтируем тот же Express-приложение, что и
 * локальный сервер. VERCEL задан на платформе, поэтому index.mjs не слушает порт.
 *
 * maxDuration: /api/me цепочкой тянет course_reg + куррикулум + секции всех
 * утверждённых курсов — на холодную уходит больше 10с, поэтому 60 (максимум Hobby).
 */
import { app } from '../server/index.mjs';

export const maxDuration = 60;

export default app;
