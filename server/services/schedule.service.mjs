import { cacheRepository } from '../repositories/cache.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';
import { demo } from '../demo-data.mjs';

const DEMO = process.env.DEMO === '1';

export class ScheduleService {
  async getCurriculum(client) {
    if (DEMO) return demo.curriculum();

    // 1. Сначала проверяем кэш студента в БД — там уже сохранён trackId
    const studentData = await cacheRepository.getStudentData(client.localUsername);
    let trackId = studentData?.track?.id;

    if (trackId) {
      const cached = await cacheRepository.getCurriculum(trackId);
      if (cached) return cached.curriculum;
    }

    // 2. Если trackId ещё нет в БД, запрашиваем страницу регистраций
    if (!trackId) {
      const me = await client.getCourseReg();
      if (me.authenticated === false) throw HttpError.sessionExpired();
      trackId = me.track?.id;
    }

    if (!trackId) {
      throw HttpError.badGateway('Не найден ID трека на странице course_reg');
    }

    const cached = await cacheRepository.getCurriculum(trackId);
    if (cached) return cached.curriculum;

    const curriculum = await client.getCurriculum(trackId);
    const withParams = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.sectionsParams);
    const sectionsDefaults = withParams?.sectionsParams ?? null;

    await cacheRepository.setCurriculum(trackId, curriculum, sectionsDefaults).catch(console.error);
    return curriculum;
  }

  async getMe(client, forceRefresh = false) {
    if (DEMO) return demo.me();

    // 1. Проверяем кэш в БД
    if (!forceRefresh) {
      const cached = await cacheRepository.getStudentData(client.localUsername);
      if (cached) return cached;
    }

    // 2. Запрашиваем свежие данные с портала SDU
    let me;
    try {
      me = await client.getCourseReg();
    } catch (err) {
      const cached = await cacheRepository.getStudentData(client.localUsername);
      if (cached) return cached;
      throw err;
    }

    if (me.authenticated === false) {
      const cached = await cacheRepository.getStudentData(client.localUsername);
      if (cached) return cached;
      throw HttpError.sessionExpired();
    }

    const trackId = me.track?.id;
    let curriculum = null;
    let def = null;

    if (trackId) {
      const cachedCurr = await cacheRepository.getCurriculum(trackId);
      if (cachedCurr) {
        curriculum = cachedCurr.curriculum;
        def = cachedCurr.sectionsDefaults;
      } else {
        try {
          curriculum = await client.getCurriculum(trackId);
          const withParams = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.sectionsParams);
          def = withParams?.sectionsParams ?? null;
          await cacheRepository.setCurriculum(trackId, curriculum, def).catch(console.error);
        } catch { /* ошибка куррикулума не должна блокировать /api/me */ }
      }
    }

    const chips = [];
    if (curriculum && Array.isArray(me.approved)) {
      const curriculumByCode = new Map(
        curriculum.semesters.flatMap((s) => s.courses).map((c) => [c.code, c])
      );

      for (const course of me.approved) {
        const params = curriculumByCode.get(course.code)?.sectionsParams ?? def;
        if (!params) continue;
        try {
          const cacheKey = `${course.code.toUpperCase()}:norm`;
          let s = await cacheRepository.getSections(cacheKey);
          if (!s) {
            s = await client.getSections({ ...params, dk: course.code });
            await cacheRepository.setSections(cacheKey, s).catch(console.error);
          }
          const n = s.theory?.find((t) => t.section === course.normalSection);
          const p = s.practice?.find((t) => t.section === course.practiceSection);
          for (const sec of [n, p]) {
            if (sec) {
              chips.push({
                code: course.code,
                kind: sec.kind,
                section: sec.section,
                teacher: sec.teacher,
                slots: sec.schedule,
              });
            }
          }
        } catch {
          // У курса может не быть секций
        }
      }
    }

    const data = {
      authenticated: true,
      term: me.term,
      isApproved: me.isApproved,
      track: me.track,
      progTrack: me.progTrack,
      approved: me.approved,
      schedule: chips,
    };

    await cacheRepository.setStudentData(client.localUsername, data).catch(console.error);
    return data;
  }

  async getSections(client, code, mufSqId) {
    if (DEMO) return demo.sections(code);

    const cacheKey = `${code.toUpperCase()}:${mufSqId || 'norm'}`;

    // Проверяем кэш секций
    const cached = await cacheRepository.getSections(cacheKey);
    if (cached) return cached;

    const curriculum = await this.getCurriculum(client);
    const found = curriculum.semesters.flatMap((s) => s.courses).find((c) => c.code.toUpperCase() === code.toUpperCase());
    const params = found?.sectionsParams;

    if (!params) {
      const studentData = await cacheRepository.getStudentData(client.localUsername);
      const progTrack = studentData?.progTrack ?? 'TRACK0';
      try {
        const searchData = await client.searchCourse(code, progTrack);
        await cacheRepository.setSections(cacheKey, searchData).catch(console.error);
        return searchData;
      } catch (searchErr) {
        if (searchErr.sessionExpired) throw searchErr;
        throw HttpError.notFound(`Курс ${code} не найден в куррикулуме и на портале`);
      }
    }

    const sectionsData = await client.getSections({ ...params, dk: code, mufSqId });
    await cacheRepository.setSections(cacheKey, sectionsData).catch(console.error);
    return sectionsData;
  }

  async searchCourse(client, code) {
    if (DEMO) return demo.sections(code);

    const studentData = await cacheRepository.getStudentData(client.localUsername);
    const progTrack = studentData?.progTrack ?? 'TRACK0';
    return client.searchCourse(code, progTrack);
  }

  async getElectives(client, payload) {
    const { dk, mufSqId, periodNo, groupName, candidates = [], codeType, lgCode, type } = payload;
    if (DEMO) {
      return { fromPortal: false, courses: candidates.map((code) => ({ code, name: '' })) };
    }

    let def = {};
    const studentData = await cacheRepository.getStudentData(client.localUsername);
    if (studentData?.track?.id) {
      const cachedCurr = await cacheRepository.getCurriculum(studentData.track.id);
      if (cachedCurr?.sectionsDefaults) def = cachedCurr.sectionsDefaults;
    }
    if (!def.pc) {
      await this.getCurriculum(client);
      const cachedCurr = await cacheRepository.getCurriculum(studentData?.track?.id);
      if (cachedCurr?.sectionsDefaults) def = cachedCurr.sectionsDefaults;
    }

    const groupTitle = groupName ? `${groupName} (${candidates.join(', ')})` : '';
    return client.getElectiveCourses({
      dk: String(dk),
      mufSqId: mufSqId ?? null,
      periodNo: periodNo ?? null,
      groupTitle,
      pc: def.pc,
      py: def.py,
      track: def.track,
      codeType: codeType ?? 'R',
      lgCode: lgCode ?? '',
      type: type ?? 'NAE',
      fallbackCodes: candidates,
    });
  }
}

export const scheduleService = new ScheduleService();
