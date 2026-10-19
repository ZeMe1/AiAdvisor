import { Router } from 'express';
import { authController } from '../controllers/auth.controller.mjs';
import { authRateLimit } from '../middlewares/rate-limit.middleware.mjs';
import { validateBody } from '../middlewares/validate.mjs';
import { loginSchema, twoFaSchema } from '../schemas/auth.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';

const router = Router();

router.use(authRateLimit);

router.post('/login', validateBody(loginSchema), asyncHandler((req, res) => authController.login(req, res)));
router.post('/2fa', validateBody(twoFaSchema), asyncHandler((req, res) => authController.twoFa(req, res)));
router.post('/logout', asyncHandler((req, res) => authController.logout(req, res)));

export default router;
