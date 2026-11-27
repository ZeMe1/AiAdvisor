import React, { useEffect, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore.js';
import { useMessagesStore } from '../../stores/messagesStore.js';
import { useToast } from './Toast.jsx';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { me, profile, logout } = useAuthStore();

  const unreadTotal = useMessagesStore((s) => s.unreadTotal);
  const initForUser = useMessagesStore((s) => s.initForUser);
  const resetStore = useMessagesStore((s) => s.resetStore);
  const syncNow = useMessagesStore((s) => s.syncNow);
  const recordAssistantReply = useMessagesStore((s) => s.recordAssistantReply);

  const activeUsername = profile?.username || me?.user?.username || me?.username || null;
  const activeRole = profile?.role || (me?.demo ? 'Student' : null);
  const canUseMessages = activeRole === 'Student' || activeRole === 'Advisor';
  const isOnMessagesPage = location.pathname.startsWith('/messages');

  const handleIncomingNotification = useCallback(
    (notif) => {
      if (!notif) return;
      // Avoid duplicate toast noise when user is already looking at Direct Chat on /messages
      if (isOnMessagesPage && notif.kind === 'direct') return;

      if (notif.kind === 'announcement') {
        const groupLabel = notif.groupName ? ` (${notif.groupName})` : '';
        toast.info(`Announcement${groupLabel} from ${notif.senderName}: "${notif.preview}"`, 5000);
      } else {
        toast.info(`New message from ${notif.senderName}: "${notif.preview}"`, 4500);
      }
    },
    [isOnMessagesPage, toast]
  );

  useEffect(() => {
    if (!activeUsername || me?.demo || !canUseMessages) {
      resetStore();
      return;
    }
    initForUser(activeUsername, activeRole);
  }, [activeUsername, activeRole, canUseMessages, me?.demo, initForUser, resetStore]);

  // Adaptive visibility-aware polling: 2s on /messages, 15s elsewhere
  useEffect(() => {
    if (!activeUsername || me?.demo || !canUseMessages) return undefined;

    const intervalMs = isOnMessagesPage ? 2000 : 15000;
    const timer = setInterval(() => {
      syncNow({ onNotification: handleIncomingNotification });
    }, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncNow({ onNotification: handleIncomingNotification });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [activeUsername, canUseMessages, isOnMessagesPage, me?.demo, syncNow, handleIncomingNotification]);

  // US28: In-app notification when AI Assistant replies while chat panel is minimized
  useEffect(() => {
    const onAssistantReply = (e) => {
      const content = e?.detail?.content;
      if (!content) return;
      const preview = recordAssistantReply(content);
      toast.info(`AI Assistant: "${preview}"`, 4500);
    };
    window.addEventListener('zeme:assistant-reply', onAssistantReply);
    return () => window.removeEventListener('zeme:assistant-reply', onAssistantReply);
  }, [recordAssistantReply, toast]);

  const handleSignOut = async () => {
    resetStore();
    await logout();
    navigate('/');
  };

  return (
    <header className="topbar">
      <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
        <span className="brand">
          ZeMe <span className="brand-sub">· SDU schedule planner</span>
        </span>
      </Link>

      <span className="topbar-info">
        {me?.term && <b>{me.term}</b>}
        {me?.user?.name && <span>{me.user.name} · {me.user.program}</span>}
        {me?.demo && <span className="demo-badge">demo data</span>}
      </span>

      <div className="topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <button
          className="btn btn-ghost"
          onClick={() => navigate('/recommendations')}
        >
          Recommendations
        </button>

        <button
          className="btn btn-ghost"
          onClick={() => navigate('/roadmap')}
        >
          Roadmap
        </button>

        <button
          className="btn btn-ghost"
          onClick={() => navigate('/simulation')}
        >
          What-If Simulator
        </button>

        {canUseMessages && (
          <button
            type="button"
            className={isOnMessagesPage ? 'btn' : 'btn btn-ghost'}
            onClick={() => navigate('/messages')}
            style={{
              position: 'relative',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.45rem',
            }}
            aria-label={unreadTotal > 0 ? `Messages (${unreadTotal} unread)` : 'Messages'}
          >
            <span>Messages</span>
            {unreadTotal > 0 && (
              <span
                style={{
                  backgroundColor: '#D9381E',
                  color: '#FFFFFF',
                  borderRadius: '999px',
                  padding: '1px 7px',
                  fontSize: '11px',
                  fontWeight: 700,
                  lineHeight: 1.4,
                  minWidth: '20px',
                  textAlign: 'center',
                }}
              >
                {unreadTotal > 99 ? '99+' : unreadTotal}
              </span>
            )}
          </button>
        )}

        {profile?.role === 'Administrator' && (
          <button className="btn" onClick={() => navigate('/admin')}>
            Admin Panel
          </button>
        )}

        {profile && (
          <div
            className="profile-btn"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            onClick={() => navigate('/profile')}
          >
            {profile.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt="Avatar"
                style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: '#0052cc',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '13px',
                }}
              >
                {(profile.display_name || profile.username || '?')[0].toUpperCase()}
              </div>
            )}
            <span>{profile.display_name || profile.username}</span>
          </div>
        )}

        <button className="btn btn-ghost" onClick={handleSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
