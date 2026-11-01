import { scheduleService } from '../services/schedule.service.mjs';
import { prerequisiteService } from '../services/prerequisite.service.mjs';
import { curriculumService } from '../services/curriculum.service.mjs';

export class ScheduleController {
  async getMe(req, res) {
    const forceRefresh = req.query.refresh === '1';
    const data = await scheduleService.getMe(req.client, forceRefresh);
    res.json(data);
  }

  async getCurriculum(req, res) {
    const sduCurriculum = await scheduleService.getCurriculum(req.client);
    if (req.user?.username) {
      const studentCompleted = sduCurriculum?.semesters?.flatMap((s) => s.courses) || [];
      const assignedCurriculum = await curriculumService.getCurriculumForStudent(
        req.user.username,
        studentCompleted,
        sduCurriculum
      );
      if (assignedCurriculum) {
        return res.json(assignedCurriculum);
      }
    }
    res.json(sduCurriculum);
  }

  async getRoadmap(req, res) {
    return this.getCurriculum(req, res);
  }

  async getEligibility(req, res) {
    const sduCurriculum = await scheduleService.getCurriculum(req.client);
    let activeCurriculum = sduCurriculum;
    if (req.user?.username) {
      const studentCompleted = sduCurriculum?.semesters?.flatMap((s) => s.courses) || [];
      const assignedCurriculum = await curriculumService.getCurriculumForStudent(
        req.user.username,
        studentCompleted,
        sduCurriculum
      );
      if (assignedCurriculum) {
        activeCurriculum = assignedCurriculum;
      }
    }
    const result = await prerequisiteService.evaluateCurriculum(activeCurriculum);
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
}

export const scheduleController = new ScheduleController();
