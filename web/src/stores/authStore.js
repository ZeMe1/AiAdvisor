import { create } from 'zustand';
import { api } from '../api.js';

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
      set({ me, stage: 'main', error: null });

      if (!me.demo) {
        try {
          const profile = await api.profile();
          set({ profile });
        } catch (e) {
          console.error('[authStore] Failed to fetch profile:', e);
        }
      }
    } catch {
      set({ stage: 'login', me: null, profile: null });
    }
  },

  login: async (username, password) => {
    set({ busy: true, error: null, loginNotice: null });
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
    try {
      await api.logout();
    } catch {
      // ignore logout network errors
    }
    set({ stage: 'login', me: null, profile: null, loginNotice: null, error: null });
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
        loginNotice: 'Сессия портала истекла — войдите заново',
      });
      return true;
    }
    return false;
  },
}));
