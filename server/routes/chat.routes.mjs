import { Router } from 'express';
import { chatController } from '../controllers/chat.controller.mjs';
import { requireAuth } from '../middlewares/auth.middleware.mjs';
import { validateBody } from '../middlewares/validate.mjs';
import { sendMessageSchema, addCourseToPlanSchema } from '../schemas/chat.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';

const router = Router();

router.use(requireAuth);

router.get('/messages', asyncHandler((req, res) => chatController.getMessages(req, res)));
router.post('/message', validateBody(sendMessageSchema), asyncHandler((req, res) => chatController.sendMessage(req, res)));
router.post('/plan/add', validateBody(addCourseToPlanSchema), asyncHandler((req, res) => chatController.addCourseToPlan(req, res)));
router.post('/plan/remove', validateBody(addCourseToPlanSchema), asyncHandler((req, res) => chatController.removeCourseFromPlan(req, res)));
router.delete('/messages', asyncHandler((req, res) => chatController.clearMessages(req, res)));

export default router;
