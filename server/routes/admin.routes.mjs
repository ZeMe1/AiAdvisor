import { Router } from 'express';
import { adminController } from '../controllers/admin.controller.mjs';
import { requireAdmin } from '../middlewares/auth.middleware.mjs';
import { validateBody } from '../middlewares/validate.mjs';
import { updateRoleSchema, blockUserSchema } from '../schemas/user.schema.mjs';
import { createGroupSchema, assignAdvisorSchema, enrollStudentSchema } from '../schemas/group.schema.mjs';
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

// Group Students Enrollment (US13)
router.get('/groups/:id/members', asyncHandler((req, res) => adminController.listGroupMembers(req, res)));
router.post('/groups/:id/members', validateBody(enrollStudentSchema), asyncHandler((req, res) => adminController.enrollStudent(req, res)));
router.delete('/groups/:id/members/:username', asyncHandler((req, res) => adminController.removeStudent(req, res)));

export default router;
