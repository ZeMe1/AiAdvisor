import { Router } from 'express';
import { scheduleController } from '../controllers/schedule.controller.mjs';
import { requireAuth } from '../middlewares/auth.middleware.mjs';
import { validateQuery, validateBody } from '../middlewares/validate.mjs';
import { sectionsQuerySchema, searchQuerySchema, electivesBodySchema } from '../schemas/schedule.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';

const router = Router();

router.use(requireAuth);

router.get('/me', asyncHandler((req, res) => scheduleController.getMe(req, res)));
router.get('/curriculum', asyncHandler((req, res) => scheduleController.getCurriculum(req, res)));
router.get('/sections', validateQuery(sectionsQuerySchema), asyncHandler((req, res) => scheduleController.getSections(req, res)));
router.get('/search', validateQuery(searchQuerySchema), asyncHandler((req, res) => scheduleController.search(req, res)));
router.post('/electives', validateBody(electivesBodySchema), asyncHandler((req, res) => scheduleController.getElectives(req, res)));

export default router;
