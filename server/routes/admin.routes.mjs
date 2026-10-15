import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.mjs';
import { requireAdmin } from '../middlewares/auth.middleware.mjs';
import { validateBody, validateParams } from '../middlewares/validate.mjs';
import { updateRoleSchema, blockUserSchema } from '../schemas/user.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';

const router = Router();

router.use(requireAdmin);

router.get('/users', asyncHandler((req, res) => adminController.listUsers(req, res)));
router.put('/users/:username/role', validateBody(updateRoleSchema), asyncHandler((req, res) => adminController.updateRole(req, res)));
router.put('/users/:username/block', validateBody(blockUserSchema), asyncHandler((req, res) => adminController.blockUser(req, res)));

export default router;
