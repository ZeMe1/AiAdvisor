import { create } from 'zustand';
import { api } from '../api.js';
import { useScheduleStore } from './scheduleStore.js';
import { usePlanStore } from './planStore.js';

export const useAuthStore = create((set, get) => ({
  stage: 'boot', // 'boot' | 'login' | '2fa' | 'main'
  me: null,
  profile: null,
  loginNotice: null,
  error: null,
  busy: false,

  setLoginNotice: (notice) => set({ loginNotice: notice }),
  setError: (err) => set({ error: err }),

  checkAuth: async () => {
    try {
      const me = await api.me();

      let profileData = null;
      if (!me.demo) {
        try {
          profileData = await api.profile();
        } catch (e) {
          console.error('[authStore] Failed to fetch profile:', e);
        }
      }

      const activeUser = profileData?.username || me?.user?.username || me?.username;
      if (activeUser) {
        useScheduleStore.getState().initForUser?.(activeUser);
        usePlanStore.getState().initForUser?.(activeUser);
      }

      set({ me, profile: profileData, stage: 'main', error: null });
    } catch {
      set({ stage: 'login', me: null, profile: null });
    }
  },

  login: async (username, password) => {
    // Reset stores and caches from any previous user session before logging in
    useScheduleStore.getState().clearAllCache?.();
    usePlanStore.getState().resetStore?.();

    set({ busy: true, error: null, loginNotice: null, me: null, profile: null });
    try {
      const res = await api.login(username, password);
      if (res.status === '2fa_required') {
        set({ stage: '2fa', busy: false });
        return res;
      }
      await get().checkAuth();
      set({ busy: false });
      return res;
    } catch (err) {
      set({ busy: false, error: err.message });
      throw err;
    }
  },

  submit2fa: async (code) => {
    set({ busy: true, error: null });
    try {
      await api.twoFa(code);
      await get().checkAuth();
      set({ busy: false });
    } catch (err) {
      set({ busy: false, error: err.message });
      throw err;
    }
  },

  logout: async () => {
    // Clear user state immediately to avoid flashing previous user's data
    useScheduleStore.getState().clearAllCache?.();
    usePlanStore.getState().resetStore?.();
    try {
      localStorage.removeItem('zeme_courses_cache_v1');
      localStorage.removeItem('zeme_curriculum_cache_v1');
      localStorage.removeItem('zeme_plan_v1');
    } catch {}
    set({ stage: 'login', me: null, profile: null, loginNotice: null, error: null });

    try {
      await api.logout();
    } catch {
      // ignore logout network errors
    }
  },

  updateProfile: async (data) => {
    const updated = await api.updateProfile(data);
    set({ profile: updated });
    return updated;
  },

  handleAuthError: (e) => {
    if (e?.status === 401 || e?.sessionExpired) {
      set({
        stage: 'login',
        me: null,
        profile: null,
        loginNotice: 'Portal session expired — please log in again',
      });
      return true;
    }
    return false;
  },
}));
