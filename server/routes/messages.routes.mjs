import { Router } from 'express';
import { messagesController } from '../controllers/messages.controller.mjs';
import { requireAuth } from '../middlewares/auth.middleware.mjs';
import { validateBody, validateQuery } from '../middlewares/validate.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';
import {
  sendDirectMessageSchema,
  sendAdvisorReplySchema,
  sendAnnouncementSchema,
  updateOfficeHoursSchema,
  syncQuerySchema,
  studentDialogQuerySchema,
} from '../schemas/messages.schema.mjs';

const router = Router();

router.use(requireAuth);

// US28 + US30: Sync & Presence
router.get('/sync', validateQuery(syncQuerySchema), asyncHandler((req, res) => messagesController.sync(req, res)));
router.get('/presence/me', asyncHandler((req, res) => messagesController.getMyPresence(req, res)));
router.put(
  '/presence/office-hours',
  validateBody(updateOfficeHoursSchema),
  asyncHandler((req, res) => messagesController.updateOfficeHours(req, res))
);
router.get(
  '/presence/advisor',
  validateQuery(studentDialogQuerySchema),
  asyncHandler((req, res) => messagesController.getStudentAdvisorPresence(req, res))
);

// US26 + US29: Student direct dialog & group announcements
router.get(
  '/student/dialog',
  validateQuery(studentDialogQuerySchema),
  asyncHandler((req, res) => messagesController.getStudentDialog(req, res))
);
router.post(
  '/student/dialog',
  validateBody(sendDirectMessageSchema),
  asyncHandler((req, res) => messagesController.sendStudentMessage(req, res))
);
router.get('/student/announcements', asyncHandler((req, res) => messagesController.getStudentAnnouncements(req, res)));
router.post(
  '/student/announcements/read',
  asyncHandler((req, res) => messagesController.markStudentAnnouncementsRead(req, res))
);

// US26 + US27 + US29: Advisor inbox, student threads & group announcements
router.get('/advisor/inbox', asyncHandler((req, res) => messagesController.getAdvisorInbox(req, res)));
router.get(
  '/advisor/threads/:studentUsername',
  asyncHandler((req, res) => messagesController.getAdvisorThread(req, res))
);
router.post(
  '/advisor/threads/:studentUsername',
  validateBody(sendAdvisorReplySchema),
  asyncHandler((req, res) => messagesController.sendAdvisorMessage(req, res))
);
router.get(
  '/advisor/groups/:groupId/announcements',
  asyncHandler((req, res) => messagesController.getGroupAnnouncements(req, res))
);
router.post(
  '/advisor/groups/:groupId/announcements',
  validateBody(sendAnnouncementSchema),
  asyncHandler((req, res) => messagesController.sendGroupAnnouncement(req, res))
);

export default router;
