import { create } from 'zustand';

function getPlanStorageKey(username) {
  return username ? `zeme_${username}_plan_v1` : 'zeme_plan_v1';
}

function loadInitialPlan(username) {
  try {
    const raw = localStorage.getItem(getPlanStorageKey(username));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistPlan(username, plan) {
  try {
    localStorage.setItem(getPlanStorageKey(username), JSON.stringify(plan));
  } catch (err) {
    console.error('[planStore] Failed to persist plan to localStorage:', err);
  }
}

export const usePlanStore = create((set, get) => ({
  currentUsername: null,
  plan: loadInitialPlan(null),

  initForUser: (username) => {
    if (!username) return;
    const plan = loadInitialPlan(username);
    set({ currentUsername: username, plan });
  },

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
      persistPlan(state.currentUsername, nextPlan);
      return { plan: nextPlan };
    });
  },

  dropFromPlan: (code) => {
    set((state) => {
      const nextPlan = state.plan.filter((p) => p.code !== code);
      persistPlan(state.currentUsername, nextPlan);
      return { plan: nextPlan };
    });
  },

  clearPlan: () => {
    const user = get().currentUsername;
    try {
      localStorage.removeItem(getPlanStorageKey(user));
      localStorage.removeItem('zeme_plan_v1');
    } catch {}
    set({ plan: [] });
  },

  resetStore: () => {
    set({ plan: [], currentUsername: null });
  },
}));
