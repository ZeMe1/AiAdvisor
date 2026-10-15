import { create } from 'zustand';
import { api } from '../api.js';
import { slotIndexOf, markConflicts } from '../schedule.js';
import { useAuthStore } from './authStore.js';
import { usePlanStore } from './planStore.js';

const NULL_DRAFT = { N: null, P: null, L: null };

export const useScheduleStore = create((set, get) => ({
  curriculum: null,
  loadingCurriculum: false,

  openCourse: null, // { code, name, data }
  draft: NULL_DRAFT,
  loadingCourse: false,
  courseError: null,

  loadCurriculum: async () => {
    if (get().curriculum) return get().curriculum;
    set({ loadingCurriculum: true });
    try {
      const curriculum = await api.curriculum();
      set({ curriculum, loadingCurriculum: false });
      return curriculum;
    } catch (err) {
      set({ loadingCurriculum: false });
      useAuthStore.getState().handleAuthError(err);
      throw err;
    }
  },

  loadCourse: async (code, mufSqId) => {
    set({ loadingCourse: true, courseError: null });
    try {
      const data = await api.sections(code, mufSqId);
      const courseCode = data.course.code ?? code;
      const openCourse = { code: courseCode, name: data.course.name, data };

      const currentPlan = usePlanStore.getState().plan;
      const existing = currentPlan.find((p) => p.code === courseCode);

      set({
        openCourse,
        draft: {
          N: existing?.theoryId ?? null,
          P: existing?.practiceId ?? null,
          L: null,
        },
        loadingCourse: false,
      });

      return openCourse;
    } catch (err) {
      set({ loadingCourse: false, courseError: err.message });
      useAuthStore.getState().handleAuthError(err);
      throw err;
    }
  },

  setDraft: (draft) => set({ draft }),

  clearOpenCourse: () => set({ openCourse: null, draft: NULL_DRAFT, courseError: null }),

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
