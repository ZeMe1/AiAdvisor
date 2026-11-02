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
router.delete('/groups/:id', asyncHandler((req, res) => adminController.deleteGroup(req, res)));
router.put('/groups/:id/advisor', validateBody(assignAdvisorSchema), asyncHandler((req, res) => adminController.assignAdvisor(req, res)));

// Group Students Enrollment (US13)
router.get('/groups/:id/members', asyncHandler((req, res) => adminController.listGroupMembers(req, res)));
router.post('/groups/:id/members', validateBody(enrollStudentSchema), asyncHandler((req, res) => adminController.enrollStudent(req, res)));
router.delete('/groups/:id/members/:username', asyncHandler((req, res) => adminController.removeStudent(req, res)));

// Curriculum Management (US14)
router.get('/curriculums', asyncHandler((req, res) => adminController.listCurriculums(req, res)));
router.post('/curriculums/preview', asyncHandler((req, res) => adminController.previewCurriculum(req, res)));
router.post('/curriculums', asyncHandler((req, res) => adminController.importCurriculum(req, res)));
router.get('/curriculums/:id', asyncHandler((req, res) => adminController.getCurriculum(req, res)));
router.patch('/curriculums/:id/publish', asyncHandler((req, res) => adminController.setCurriculumPublished(req, res)));
router.delete('/curriculums/:id', asyncHandler((req, res) => adminController.deleteCurriculum(req, res)));
router.get('/curriculums/:id/students', asyncHandler((req, res) => adminController.listCurriculumStudents(req, res)));
router.post('/curriculums/:id/students', asyncHandler((req, res) => adminController.assignCurriculumStudent(req, res)));
router.delete('/curriculums/:id/students/:username', asyncHandler((req, res) => adminController.removeCurriculumStudent(req, res)));

export default router;
