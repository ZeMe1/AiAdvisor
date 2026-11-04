import { Router } from 'express';
import { scheduleController } from '../controllers/schedule.controller.mjs';
import { requireAuth } from '../middlewares/auth.middleware.mjs';
import { validateQuery, validateBody } from '../middlewares/validate.mjs';
import { sectionsQuerySchema, searchQuerySchema, electivesBodySchema, simulationBodySchema } from '../schemas/schedule.schema.mjs';
import { asyncHandler } from '../middlewares/error.middleware.mjs';

const router = Router();

router.use(requireAuth);

router.get('/me', asyncHandler((req, res) => scheduleController.getMe(req, res)));
router.get('/curriculum', asyncHandler((req, res) => scheduleController.getCurriculum(req, res)));
router.get('/roadmap', asyncHandler((req, res) => scheduleController.getRoadmap(req, res)));
router.get('/eligibility', asyncHandler((req, res) => scheduleController.getEligibility(req, res)));
router.get('/recommendations', asyncHandler((req, res) => scheduleController.getRecommendations(req, res)));
router.post('/recommendations/feedback', asyncHandler((req, res) => scheduleController.submitRecommendationFeedback(req, res)));
router.get('/simulation', asyncHandler((req, res) => scheduleController.getSimulation(req, res)));
router.post('/simulation', validateBody(simulationBodySchema), asyncHandler((req, res) => scheduleController.simulateWhatIf(req, res)));
router.get('/sections', validateQuery(sectionsQuerySchema), asyncHandler((req, res) => scheduleController.getSections(req, res)));
router.get('/search', validateQuery(searchQuerySchema), asyncHandler((req, res) => scheduleController.search(req, res)));
router.post('/electives', validateBody(electivesBodySchema), asyncHandler((req, res) => scheduleController.getElectives(req, res)));

export default router;
