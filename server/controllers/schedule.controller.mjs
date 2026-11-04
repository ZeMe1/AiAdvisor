import { scheduleService } from '../services/schedule.service.mjs';
import { prerequisiteService } from '../services/prerequisite.service.mjs';
import { curriculumService } from '../services/curriculum.service.mjs';
import { recommendationService } from '../services/recommendation.service.mjs';
import { simulationService } from '../services/simulation.service.mjs';

export class ScheduleController {
  async getMe(req, res) {
    const forceRefresh = req.query.refresh === '1';
    const data = await scheduleService.getMe(req.client, forceRefresh);
    const username = req.client?.localUsername || req.session?.username;
    if (data && username && (!data.user || !data.user.username)) {
      data.user = { ...(data.user || {}), username };
    }
    res.json(data);
  }

  async getCurriculum(req, res) {
    const data = await scheduleService.getCurriculum(req.client);
    res.json(data);
  }

  async getRoadmap(req, res) {
    const sduCurriculum = await scheduleService.getCurriculum(req.client);
    const username = req.session?.username || req.client?.localUsername;
    const studentCompleted = sduCurriculum?.semesters?.flatMap((s) => s.courses) || [];

    const roadmapData = await curriculumService.getRoadmapCurriculumsForStudent(
      username,
      studentCompleted,
      sduCurriculum
    );
    res.json(roadmapData);
  }

  async getEligibility(req, res) {
    const sduCurriculum = await scheduleService.getCurriculum(req.client);
    const result = await prerequisiteService.evaluateCurriculum(sduCurriculum);
    res.json(result);
  }

  async getRecommendations(req, res) {
    const data = await recommendationService.getRecommendations(req.client);
    res.json(data);
  }

  async submitRecommendationFeedback(req, res) {
    const { courseCode, isInterested, targetSemester } = req.body;
    const result = await recommendationService.submitFeedback(req.client, {
      courseCode,
      isInterested,
      targetSemester,
    });
    res.json(result);
  }

  async getSections(req, res) {
    const { code, mufSqId } = req.query;
    const data = await scheduleService.getSections(req.client, code, mufSqId);
    res.json(data);
  }

  async search(req, res) {
    const { code } = req.query;
    const data = await scheduleService.searchCourse(req.client, code);
    res.json(data);
  }

  async getElectives(req, res) {
    const data = await scheduleService.getElectives(req.client, req.body);
    res.json(data);
  }

  async simulateWhatIf(req, res) {
    const { targetEctsPerSemester, numSemesters } = req.body || {};
    const result = await simulationService.simulateWhatIf(req.client, {
      targetEctsPerSemester,
      numSemesters,
    });
    res.json(result);
  }

  async getSimulation(req, res) {
    const { targetEctsPerSemester, numSemesters } = req.query || {};
    const result = await simulationService.simulateWhatIf(req.client, {
      targetEctsPerSemester: targetEctsPerSemester ? Number(targetEctsPerSemester) : 21,
      numSemesters: numSemesters ? Number(numSemesters) : 2,
    });
    res.json(result);
  }
}

export const scheduleController = new ScheduleController();
