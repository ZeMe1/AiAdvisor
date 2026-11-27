import { create } from 'zustand';
import { api } from '../api.js';

function truncatePreviewClient(text, maxLen = 75) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

export const useMessagesStore = create((set, get) => ({
  initializedUser: null,
  role: null,
  unreadDirect: 0,
  unreadAnnouncements: 0,
  unreadTotal: 0,
  unreadAssistant: 0,
  lastCursor: null,
  seenNotificationIds: [],
  syncVersion: 0,
  inFlight: false,

  resetStore: () =>
    set({
      initializedUser: null,
      role: null,
      unreadDirect: 0,
      unreadAnnouncements: 0,
      unreadTotal: 0,
      unreadAssistant: 0,
      lastCursor: null,
      seenNotificationIds: [],
      syncVersion: 0,
      inFlight: false,
    }),

  initForUser: (username, role) => {
    const cleanUser = username ? String(username).trim() : null;
    if (!cleanUser) {
      get().resetStore();
      return;
    }

    const prevUser = get().initializedUser;
    if (prevUser !== cleanUser) {
      set({
        initializedUser: cleanUser,
        role: role || 'Student',
        unreadDirect: 0,
        unreadAnnouncements: 0,
        unreadTotal: 0,
        unreadAssistant: 0,
        lastCursor: null,
        seenNotificationIds: [],
        syncVersion: 0,
        inFlight: false,
      });
      get().syncNow({ isBoot: true });
    } else if (role && get().role !== role) {
      set({ role });
    }
  },

  /**
   * Background incremental sync.
   * IMPORTANT: Background polling errors NEVER call authStore.handleAuthError.
   */
  syncNow: async ({ onNotification = null, isBoot = false } = {}) => {
    const state = get();
    if (!state.initializedUser || state.inFlight) return null;
    if (state.role !== 'Student' && state.role !== 'Advisor') return null;
    if (
      !isBoot &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return null;
    }

    set({ inFlight: true });
    try {
      const since = isBoot ? null : state.lastCursor;
      const res = await api.syncMessages(since);

      const seenSet = new Set(get().seenNotificationIds);
      const freshNotifications = [];

      if (!isBoot && Array.isArray(res?.notifications)) {
        for (const n of res.notifications) {
          if (!n?.id || seenSet.has(n.id)) continue;
          seenSet.add(n.id);
          freshNotifications.push(n);
        }
      }

      const nextUnreadDirect = Number(res?.unreadDirect) || 0;
      const nextUnreadAnnouncements = Number(res?.unreadAnnouncements) || 0;
      const nextUnreadTotal = Number(res?.unreadTotal) || 0;
      const prevUnreadTotal = get().unreadTotal;

      const trimmedSeen = Array.from(seenSet).slice(-200);
      const shouldBumpVersion =
        freshNotifications.length > 0 || nextUnreadTotal !== prevUnreadTotal;

      set((curr) => ({
        unreadDirect: nextUnreadDirect,
        unreadAnnouncements: nextUnreadAnnouncements,
        unreadTotal: nextUnreadTotal,
        lastCursor: res?.serverTime || curr.lastCursor || new Date().toISOString(),
        seenNotificationIds: trimmedSeen,
        syncVersion: shouldBumpVersion ? curr.syncVersion + 1 : curr.syncVersion,
        inFlight: false,
      }));

      if (onNotification && freshNotifications.length > 0) {
        for (const notif of freshNotifications) {
          onNotification(notif);
        }
      }

      return res;
    } catch (err) {
      // Never trigger handleAuthError on secondary/background message polling
      console.debug('[messagesStore] sync skipped:', err?.message);
      set({ inFlight: false });
      return null;
    }
  },

  refreshCountsNow: async () => {
    return get().syncNow({ isBoot: false });
  },

  setUnreadCountsLocal: ({ unreadDirect, unreadAnnouncements }) =>
    set((curr) => {
      const d = unreadDirect !== undefined ? Math.max(0, Number(unreadDirect) || 0) : curr.unreadDirect;
      const a =
        unreadAnnouncements !== undefined
          ? Math.max(0, Number(unreadAnnouncements) || 0)
          : curr.unreadAnnouncements;
      return {
        unreadDirect: d,
        unreadAnnouncements: a,
        unreadTotal: d + a,
      };
    }),

  recordAssistantReply: (rawText) => {
    const preview = truncatePreviewClient(rawText, 75);
    set((curr) => ({ unreadAssistant: curr.unreadAssistant + 1 }));
    return preview;
  },

  clearAssistantUnread: () => set({ unreadAssistant: 0 }),
}));
