import { create } from 'zustand';

const PLAN_STORAGE_KEY = 'zeme_plan_v1';

function loadInitialPlan() {
  try {
    const raw = localStorage.getItem(PLAN_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistPlan(plan) {
  try {
    localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
  } catch (err) {
    console.error('[planStore] Failed to persist plan to localStorage:', err);
  }
}

export const usePlanStore = create((set) => ({
  plan: loadInitialPlan(),

  addToPlan: ({ code, name, theory, practice, lab }) => {
    const entry = {
      code,
      name,
      theoryId: theory.id,
      practiceId: practice?.id ?? null,
      labId: lab?.id ?? null,
      theory: { section: theory.section, teacher: theory.teacher, schedule: theory.schedule },
      practice: practice ? { section: practice.section, teacher: practice.teacher, schedule: practice.schedule } : null,
      lab: lab ? { section: lab.section, teacher: lab.teacher, schedule: lab.schedule } : null,
    };

    set((state) => {
      const nextPlan = [...state.plan.filter((p) => p.code !== code), entry];
      persistPlan(nextPlan);
      return { plan: nextPlan };
    });
  },

  dropFromPlan: (code) => {
    set((state) => {
      const nextPlan = state.plan.filter((p) => p.code !== code);
      persistPlan(nextPlan);
      return { plan: nextPlan };
    });
  },

  clearPlan: () => {
    persistPlan([]);
    set({ plan: [] });
  },
}));
