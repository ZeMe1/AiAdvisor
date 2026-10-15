import { Router } from 'express';
import { userController } from '../controllers/user.controller.mjs';
import { requireAuth } from '../middlewares/auth.middleware.mjs';
import { validateBody } from '../middlewares/validate.mjs';
import { updateProfileSchema } from '../schemas/user.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';

const router = Router();

router.use(requireAuth);

router.get('/profile', asyncHandler((req, res) => userController.getProfile(req, res)));
router.put('/profile', validateBody(updateProfileSchema), asyncHandler((req, res) => userController.updateProfile(req, res)));

export default router;
