import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.mjs';
import { requireAdmin } from '../middlewares/auth.middleware.mjs';
import { validateBody } from '../middlewares/validate.mjs';
import { updateRoleSchema, blockUserSchema } from '../schemas/user.schema.mjs';
import { createGroupSchema, assignAdvisorSchema, importPreviewSchema, importExecuteSchema } from '../schemas/group.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';

const router = Router();

router.use(requireAdmin);

// User Management
router.get('/users', asyncHandler((req, res) => adminController.listUsers(req, res)));
router.put('/users/:username/role', validateBody(updateRoleSchema), asyncHandler((req, res) => adminController.updateRole(req, res)));
router.put('/users/:username/block', validateBody(blockUserSchema), asyncHandler((req, res) => adminController.blockUser(req, res)));

// Group & Advisor Management (US13)
router.get('/groups', asyncHandler((req, res) => adminController.listGroups(req, res)));
router.post('/groups', validateBody(createGroupSchema), asyncHandler((req, res) => adminController.createGroup(req, res)));
router.put('/groups/:id/advisor', validateBody(assignAdvisorSchema), asyncHandler((req, res) => adminController.assignAdvisor(req, res)));
router.post('/groups/import/preview', validateBody(importPreviewSchema), asyncHandler((req, res) => adminController.previewImport(req, res)));
router.post('/groups/import', validateBody(importExecuteSchema), asyncHandler((req, res) => adminController.executeImport(req, res)));

export default router;
