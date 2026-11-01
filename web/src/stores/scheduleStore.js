import { create } from 'zustand';
import { api } from '../api.js';
import { slotIndexOf, markConflicts } from '../schedule.js';
import { useAuthStore } from './authStore.js';
import { usePlanStore } from './planStore.js';

const NULL_DRAFT = { N: null, P: null, L: null };
const COURSES_STORAGE_KEY = 'zeme_courses_cache_v1';
const CURRICULUM_STORAGE_KEY = 'zeme_curriculum_cache_v1';

function loadInitialCoursesCache() {
  try {
    const raw = localStorage.getItem(COURSES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistCoursesCache(cache) {
  try {
    localStorage.setItem(COURSES_STORAGE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.error('[scheduleStore] Failed to persist courses cache to localStorage:', err);
  }
}

function loadInitialCurriculumCache() {
  try {
    const raw = localStorage.getItem(CURRICULUM_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistCurriculumCache(curriculum) {
  try {
    localStorage.setItem(CURRICULUM_STORAGE_KEY, JSON.stringify(curriculum));
  } catch (err) {
    console.error('[scheduleStore] Failed to persist curriculum cache to localStorage:', err);
  }
}

export const clearScheduleLocalStorage = () => {
  try {
    localStorage.removeItem(COURSES_STORAGE_KEY);
    localStorage.removeItem(CURRICULUM_STORAGE_KEY);
  } catch {}
};

export const useScheduleStore = create((set, get) => ({
  curriculum: loadInitialCurriculumCache(),
  loadingCurriculum: false,

  coursesCache: loadInitialCoursesCache(),

  openCourse: null, // { code, name, data }
  draft: NULL_DRAFT,
  loadingCourse: false,
  courseError: null,

  loadCurriculum: async (force = false) => {
    if (!force && get().curriculum) return get().curriculum;
    set({ loadingCurriculum: true });
    try {
      const curriculum = await api.curriculum();
      persistCurriculumCache(curriculum);
      set({ curriculum, loadingCurriculum: false });
      return curriculum;
    } catch (err) {
      set({ loadingCurriculum: false });
      // Если в кэше уже есть куррикулум, отдаем его без разлогина
      if (get().curriculum) {
        console.warn('[scheduleStore] Using locally cached curriculum due to network/API error:', err.message);
        return get().curriculum;
      }
      useAuthStore.getState().handleAuthError(err);
      throw err;
    }
  },

  loadCourse: async (code, mufSqId) => {
    const cacheKey = `${code.toUpperCase()}:${mufSqId || 'norm'}`;
    const cachedData = get().coursesCache[cacheKey];

    const currentPlan = usePlanStore.getState().plan;

    const applyCourseData = (data) => {
      const courseCode = data.course?.code ?? code;
      const openCourse = { code: courseCode, name: data.course?.name, data };
      const existing = currentPlan.find((p) => p.code === courseCode);

      set({
        openCourse,
        draft: {
          N: existing?.theoryId ?? null,
          P: existing?.practiceId ?? null,
          L: null,
        },
        loadingCourse: false,
        courseError: null,
      });

      return openCourse;
    };

    // 1. Local-First: если курс уже есть в локальном кэше — отдаём МГНОВЕННО без сетевых запросов!
    if (cachedData) {
      return applyCourseData(cachedData);
    }

    // 2. Иначе запрашиваем с сервера и кэшируем локально
    set({ loadingCourse: true, courseError: null });
    try {
      const data = await api.sections(code, mufSqId);
      const nextCache = { ...get().coursesCache, [cacheKey]: data };
      persistCoursesCache(nextCache);
      set({ coursesCache: nextCache });

      return applyCourseData(data);
    } catch (err) {
      // Fallback на кэш, если доступен
      if (cachedData) {
        console.warn(`[scheduleStore] Returning cached sections for ${code} after error:`, err.message);
        return applyCourseData(cachedData);
      }
      set({ loadingCourse: false, courseError: err.message });
      // Не вызываем handleAuthError, чтобы ошибка загрузки секций курса не разлогинивала пользователя
      throw err;
    }
  },

  setDraft: (draft) => set({ draft }),

  clearOpenCourse: () => set({ openCourse: null, draft: NULL_DRAFT, courseError: null }),

  clearAllCache: () => {
    clearScheduleLocalStorage();
    set({ coursesCache: {}, curriculum: null });
  },

  /**
   * Чистая функция-селектор для вычисления всех цветных чипов сетки расписания
   */
  getScheduleChips: (isCourseView = false) => {
    const { me } = useAuthStore.getState();
    const { plan } = usePlanStore.getState();
    const { openCourse, draft } = get();

    const list = [];

    // 1. Чипы утверждённой корзины SDU (зелёные)
    for (const c of me?.schedule ?? []) {
      const label = `${c.code} [${c.section}-${c.kind}]`;
      for (const s of c.slots ?? []) {
        list.push({
          code: c.code,
          kind: c.kind,
          teacher: c.teacher,
          label,
          color: 'basket',
          day: s.day - 1,
          row: slotIndexOf(s.time),
        });
      }
    }

    // 2. Чипы из локального плана студента (тёмно-синие)
    for (const p of plan) {
      for (const [kind, sec] of [['N', p.theory], ['P', p.practice], ['L', p.lab]]) {
        if (!sec) continue;
        const label = `${p.code} [${sec.section}-${kind}]`;
        for (const s of sec.schedule ?? []) {
          list.push({
            code: p.code,
            kind,
            teacher: sec.teacher,
            label,
            color: 'sel',
            day: s.day - 1,
            row: slotIndexOf(s.time),
          });
        }
      }
    }

    // 3. Выбранные драфт-секции открытого курса (если пользователь на странице курса)
    if (isCourseView && openCourse) {
      const entry = plan.find((p) => p.code === openCourse.code);
      const groups = [
        ['N', openCourse.data.theory, draft.N, entry?.theoryId],
        ['P', openCourse.data.practice, draft.P, entry?.practiceId],
        ['L', openCourse.data.lab ?? [], draft.L, entry?.labId],
      ];
      for (const [kind, arr, draftId, planId] of groups) {
        if (!draftId || draftId === planId) continue;
        const sec = arr.find((s) => s.id === draftId);
        if (!sec) continue;
        const label = `${openCourse.code.replace(' ', '')} [${sec.section}-${kind}]`;
        for (const slot of sec.schedule ?? []) {
          list.push({
            code: openCourse.code,
            kind,
            teacher: sec.teacher,
            label,
            color: 'sel',
            day: slot.day - 1,
            row: slotIndexOf(slot.time),
          });
        }
      }
    }

    return markConflicts(list);
  },
}));
