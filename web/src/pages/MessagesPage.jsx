import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import { useMessagesStore } from '../stores/messagesStore.js';
import { useToast } from '../shared/ui/Toast.jsx';

const QUICK_EMOJIS = ['👋', '👍', '✅', '📚', '🎓', '📅', '❓', '🙏'];

function formatDateTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  if (sameDay) return time;
  const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${datePart}, ${time}`;
}

function formatShortDate(isoString) {
  if (!isoString) return 'None yet';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return 'None yet';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function PresenceBadge({ presence }) {
  const status = presence?.status || 'offline';
  const statusText = presence?.statusText || 'Offline';
  const cls =
    status === 'online'
      ? 'msg-presence-pill is-online'
      : status === 'away'
        ? 'msg-presence-pill is-away'
        : 'msg-presence-pill is-offline';

  return (
    <span className={cls}>
      <span className="msg-presence-dot" />
      <span>{statusText}</span>
    </span>
  );
}

function AvatarCircle({ name, avatarUrl, size = 40, bg = '#002B49' }) {
  const letter = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      className="msg-avatar"
      style={{ width: size, height: size, backgroundColor: bg }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name || 'Avatar'} />
      ) : (
        <span>{letter}</span>
      )}
    </div>
  );
}

/* ============================================================================
   STUDENT MESSAGING VIEW (US26, US28, US29, US30)
   ============================================================================ */
function StudentMessagesView() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedAdvisor = searchParams.get('advisor') || '';

  const unreadDirect = useMessagesStore((s) => s.unreadDirect);
  const unreadAnnouncements = useMessagesStore((s) => s.unreadAnnouncements);
  const syncVersion = useMessagesStore((s) => s.syncVersion);
  const setUnreadCountsLocal = useMessagesStore((s) => s.setUnreadCountsLocal);
  const refreshCountsNow = useMessagesStore((s) => s.refreshCountsNow);

  const [activeTab, setActiveTab] = useState('direct'); // 'direct' | 'announcements'
  const [dialog, setDialog] = useState(null);
  const [forbiddenError, setForbiddenError] = useState(null);
  const [loadingDialog, setLoadingDialog] = useState(true);
  const [annData, setAnnData] = useState(null);
  const [loadingAnns, setLoadingAnns] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const prevMsgCountRef = useRef(0);

  const loadDialog = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingDialog(true);
      try {
        const res = await api.getStudentDialog(requestedAdvisor || undefined);
        setForbiddenError(null);
        setDialog(res);
        setUnreadCountsLocal({ unreadDirect: 0 });
      } catch (err) {
        if (err?.status === 403) {
          setForbiddenError(err.message || 'You can only message your own group advisor');
          setDialog(null);
        } else if (!silent) {
          toast.error(err?.message || 'Failed to load conversation');
        }
      } finally {
        if (!silent) setLoadingDialog(false);
      }
    },
    [requestedAdvisor, setUnreadCountsLocal, toast]
  );

  const loadAnnouncements = useCallback(
    async ({ markRead = false, silent = false } = {}) => {
      if (!silent) setLoadingAnns(true);
      try {
        const res = markRead
          ? await api.markStudentAnnouncementsRead()
          : await api.getStudentAnnouncements();
        setAnnData(res);
        setUnreadCountsLocal({ unreadAnnouncements: Number(res?.unreadCount) || 0 });
      } catch (err) {
        if (!silent) toast.error(err?.message || 'Failed to load group announcements');
      } finally {
        if (!silent) setLoadingAnns(false);
      }
    },
    [setUnreadCountsLocal, toast]
  );

  useEffect(() => {
    loadDialog(false);
    loadAnnouncements({ markRead: false, silent: true });
  }, [loadDialog, loadAnnouncements]);

  // Refresh active channel when syncVersion bumps or on 2s live poll
  useEffect(() => {
    if (forbiddenError) return undefined;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (activeTab === 'direct') {
        loadDialog(true);
      } else {
        loadAnnouncements({ markRead: true, silent: true });
      }
    };
    const timer = setInterval(tick, 2500);
    return () => clearInterval(timer);
  }, [activeTab, forbiddenError, syncVersion, loadDialog, loadAnnouncements]);

  useEffect(() => {
    if (activeTab === 'announcements') {
      loadAnnouncements({ markRead: true, silent: false });
    } else if (!forbiddenError) {
      loadDialog(true);
    }
  }, [activeTab, forbiddenError, loadAnnouncements, loadDialog]);

  const msgCount = dialog?.messages?.length || 0;
  useEffect(() => {
    if (activeTab === 'direct' && msgCount !== prevMsgCountRef.current) {
      prevMsgCountRef.current = msgCount;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTab, msgCount]);

  const handleSend = async (e) => {
    if (e) e.preventDefault();
    const text = draft.trim();
    if (!text || sending || forbiddenError || !dialog?.assigned) return;

    setSending(true);
    try {
      const res = await api.sendStudentMessage({
        advisorUsername: requestedAdvisor || undefined,
        content: text,
      });
      setDraft('');
      if (res?.message) {
        setDialog((prev) =>
          prev
            ? {
                ...prev,
                messages: [...(prev.messages || []), res.message],
              }
            : prev
        );
      }
      refreshCountsNow();
    } catch (err) {
      if (err?.status === 403) {
        setForbiddenError(err.message || 'You can only message your own group advisor');
      } else {
        toast.error(err?.message || 'Failed to send message');
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const advisor = dialog?.advisor;
  const group = dialog?.group || annData?.group;
  const presence = dialog?.presence;

  return (
    <div className="msg-shell">
      {/* Left Sidebar: Channels */}
      <aside className="msg-sidebar">
        <div className="msg-sidebar-header">
          <div>
            <h2 className="msg-sidebar-title">Messages</h2>
            <p className="msg-sidebar-sub">Advisor consultation & group channel</p>
          </div>
        </div>

        <div className="msg-channel-list">
          <button
            type="button"
            className={`msg-channel-item ${activeTab === 'direct' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('direct')}
          >
            <AvatarCircle
              name={advisor?.display_name || advisor?.username || 'A'}
              avatarUrl={advisor?.avatar_url}
              size={40}
              bg="#002B49"
            />
            <div className="msg-channel-meta">
              <div className="msg-channel-top">
                <span className="msg-channel-name">
                  {advisor ? advisor.display_name || advisor.username : 'Direct Advisor Chat'}
                </span>
                {unreadDirect > 0 && <span className="msg-unread-badge">{unreadDirect}</span>}
              </div>
              <div className="msg-channel-sub">
                {presence?.statusText || (advisor ? 'Direct 1-to-1 consultation' : 'Advisor status')}
              </div>
            </div>
          </button>

          <button
            type="button"
            className={`msg-channel-item ${activeTab === 'announcements' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('announcements')}
          >
            <div className="msg-avatar" style={{ width: 40, height: 40, backgroundColor: '#0070BA' }}>
              <span>📢</span>
            </div>
            <div className="msg-channel-meta">
              <div className="msg-channel-top">
                <span className="msg-channel-name">
                  {group ? `${group.name} Announcements` : 'Group Announcements'}
                </span>
                {unreadAnnouncements > 0 && (
                  <span className="msg-unread-badge">{unreadAnnouncements}</span>
                )}
              </div>
              <div className="msg-channel-sub">Official broadcasts from your advisor</div>
            </div>
          </button>
        </div>
      </aside>

      {/* Right Main Panel */}
      <section className="msg-main">
        {activeTab === 'direct' ? (
          forbiddenError ? (
            <div className="msg-empty-state msg-forbidden-state">
              <div className="msg-forbidden-icon">🔒</div>
              <h3>Access Restricted</h3>
              <p className="msg-forbidden-text">{forbiddenError}</p>
              {requestedAdvisor && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setSearchParams({});
                    setForbiddenError(null);
                  }}
                >
                  Switch to My Assigned Advisor
                </button>
              )}
            </div>
          ) : loadingDialog ? (
            <div className="msg-empty-state">
              <p className="muted">Loading advisor conversation…</p>
            </div>
          ) : !dialog?.assigned ? (
            <div className="msg-empty-state">
              <h3>No Assigned Advisor Yet</h3>
              <p className="muted">
                {dialog?.group
                  ? `Your study group (${dialog.group.name}) does not have an assigned academic advisor yet.`
                  : 'You are not currently enrolled in a study group. Once enrolled, you can message your group advisor directly here.'}
              </p>
            </div>
          ) : (
            <>
              {/* Direct Chat Header with Presence & Office Hours */}
              <header className="msg-chat-header">
                <div className="msg-chat-header-main">
                  <AvatarCircle
                    name={advisor?.display_name || advisor?.username}
                    avatarUrl={advisor?.avatar_url}
                    size={44}
                    bg="#002B49"
                  />
                  <div className="msg-chat-header-info">
                    <div className="msg-chat-title-row">
                      <span className="msg-chat-title">{advisor?.display_name || advisor?.username}</span>
                      <PresenceBadge presence={presence} />
                    </div>
                    <div className="msg-chat-subtitle">
                      Group {dialog.group?.name} · {dialog.group?.program}
                    </div>
                  </div>
                </div>

                {(presence?.officeHours || presence?.responseTimeNote) && (
                  <div className="msg-office-bar">
                    {presence?.officeHours && (
                      <span>
                        <strong>Office Hours:</strong> {presence.officeHours}
                      </span>
                    )}
                    {presence?.responseTimeNote && (
                      <span>
                        <strong>Typical Response:</strong> {presence.responseTimeNote}
                      </span>
                    )}
                  </div>
                )}
              </header>

              {/* Messages Stream */}
              <div className="msg-stream">
                {(dialog.messages || []).length === 0 ? (
                  <div className="msg-empty-thread">
                    <p style={{ fontWeight: 700, color: '#002B49', marginBottom: 4 }}>
                      Start a conversation with {advisor?.display_name || advisor?.username}
                    </p>
                    <p className="muted small" style={{ margin: 0 }}>
                      Ask questions about your study plan, course prerequisites, or registration schedule.
                    </p>
                  </div>
                ) : (
                  dialog.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`msg-bubble-row ${m.isMine ? 'is-mine' : 'is-theirs'}`}
                    >
                      <div className={`msg-bubble ${m.isMine ? 'bubble-mine' : 'bubble-theirs'}`}>
                        <div className="msg-bubble-content">{m.content}</div>
                        <div className="msg-bubble-meta">
                          <span>{formatDateTime(m.createdAt)}</span>
                          {m.isMine && (
                            <span className="msg-read-flag">
                              {m.isRead ? '· Read ✓✓' : '· Sent ✓'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* Plain-Text & Emoji Composer */}
              <form className="msg-composer" onSubmit={handleSend}>
                <div className="msg-emoji-bar">
                  {QUICK_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className="msg-emoji-btn"
                      onClick={() => setDraft((prev) => (prev.length < 1998 ? `${prev}${em}` : prev))}
                      title={`Insert ${em}`}
                    >
                      {em}
                    </button>
                  ))}
                  <span className="msg-char-counter">{draft.length} / 2000</span>
                </div>
                <div className="msg-composer-row">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    maxLength={2000}
                    rows={2}
                    placeholder={`Write a message to ${advisor?.display_name || advisor?.username || 'your advisor'}... (Enter to send, Shift+Enter for new line)`}
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary msg-send-btn"
                    disabled={!draft.trim() || sending}
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </>
          )
        ) : (
          /* Student Group Announcements Channel */
          <>
            <header className="msg-chat-header">
              <div className="msg-chat-header-main">
                <div className="msg-avatar" style={{ width: 44, height: 44, backgroundColor: '#0070BA' }}>
                  <span>📢</span>
                </div>
                <div className="msg-chat-header-info">
                  <div className="msg-chat-title-row">
                    <span className="msg-chat-title">
                      {annData?.group ? `${annData.group.name} — Group Announcements` : 'Group Announcements'}
                    </span>
                    <span className="msg-ann-badge">Announcement Channel</span>
                  </div>
                  <div className="msg-chat-subtitle">
                    {annData?.group
                      ? `${annData.group.program} · Year ${annData.group.study_year}`
                      : 'Official updates from your assigned group advisor'}
                  </div>
                </div>
              </div>
            </header>

            <div className="msg-stream">
              {loadingAnns && !annData ? (
                <p className="muted" style={{ textAlign: 'center', margin: 'auto' }}>
                  Loading announcements…
                </p>
              ) : !annData?.group ? (
                <div className="msg-empty-thread">
                  <p style={{ fontWeight: 700, color: '#002B49', marginBottom: 4 }}>No Study Group Assigned</p>
                  <p className="muted small" style={{ margin: 0 }}>
                    Group announcements appear here once you are enrolled in an academic group.
                  </p>
                </div>
              ) : (annData.announcements || []).length === 0 ? (
                <div className="msg-empty-thread">
                  <p style={{ fontWeight: 700, color: '#002B49', marginBottom: 4 }}>No Announcements Yet</p>
                  <p className="muted small" style={{ margin: 0 }}>
                    Important deadlines, meeting times, and registration notices from your advisor will appear here.
                  </p>
                </div>
              ) : (
                annData.announcements.map((ann) => (
                  <article key={ann.id} className="msg-ann-card">
                    <div className="msg-ann-card-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="msg-ann-badge">{ann.badge || 'Announcement'}</span>
                        <strong style={{ color: '#002B49', fontSize: 13.5 }}>
                          {ann.advisorDisplayName || ann.advisorUsername}
                        </strong>
                        <span className="muted small">· Group {ann.groupName}</span>
                      </div>
                      <span className="muted small">{formatDateTime(ann.createdAt)}</span>
                    </div>
                    <div className="msg-ann-card-body">{ann.content}</div>
                    <div className="msg-ann-card-footer">
                      <span className="muted small">Broadcast announcement</span>
                      <button
                        type="button"
                        className="btn btn-mini"
                        onClick={() => setActiveTab('direct')}
                      >
                        Reply in Direct Chat →
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/* ============================================================================
   ADVISOR MESSAGING & INBOX VIEW (US26, US27, US28, US29, US30)
   ============================================================================ */
function AdvisorMessagesView() {
  const navigate = useNavigate();
  const toast = useToast();

  const syncVersion = useMessagesStore((s) => s.syncVersion);
  const setUnreadCountsLocal = useMessagesStore((s) => s.setUnreadCountsLocal);
  const refreshCountsNow = useMessagesStore((s) => s.refreshCountsNow);

  const [inbox, setInbox] = useState({ groups: [], students: [], totalUnread: 0 });
  const [loadingInbox, setLoadingInbox] = useState(true);

  const [selectedGroupId, setSelectedGroupId] = useState('all'); // 'all' | number
  const [panelMode, setPanelMode] = useState('dialogs'); // 'dialogs' | 'announcements'
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedStudentUsername, setSelectedStudentUsername] = useState(null);
  const [thread, setThread] = useState(null);
  const [loadingThread, setLoadingThread] = useState(false);
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);

  const [replyDraft, setReplyDraft] = useState('');
  const [sendingReply, setSendingReply] = useState(false);

  // Group announcements state (US29)
  const [annGroupId, setAnnGroupId] = useState(null);
  const [groupAnns, setGroupAnns] = useState([]);
  const [loadingGroupAnns, setLoadingGroupAnns] = useState(false);
  const [annDraft, setAnnDraft] = useState('');
  const [sendingAnn, setSendingAnn] = useState(false);

  const bottomRef = useRef(null);
  const prevThreadMsgCountRef = useRef(0);

  const loadInbox = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingInbox(true);
      try {
        const res = await api.getAdvisorInbox();
        setInbox(res || { groups: [], students: [], totalUnread: 0 });
        setUnreadCountsLocal({
          unreadDirect: Number(res?.totalUnread) || 0,
          unreadAnnouncements: 0,
        });

        if (res?.groups?.length > 0) {
          setAnnGroupId((prev) => prev || res.groups[0].id);
        }
      } catch (err) {
        if (!silent) toast.error(err?.message || 'Failed to load advisor inbox');
      } finally {
        if (!silent) setLoadingInbox(false);
      }
    },
    [setUnreadCountsLocal, toast]
  );

  const loadStudentThread = useCallback(
    async (studentUsername, silent = false) => {
      if (!studentUsername) return;
      if (!silent) setLoadingThread(true);
      try {
        const res = await api.getAdvisorThread(studentUsername);
        setThread(res);

        // Immediately clear unreadCount for this student in local inbox state (US27 Scenario 2)
        setInbox((prev) => {
          let cleared = 0;
          const nextStudents = (prev.students || []).map((s) => {
            if (s.username.toLowerCase() === studentUsername.toLowerCase()) {
              cleared = s.unreadCount || 0;
              return { ...s, unreadCount: 0 };
            }
            return s;
          });
          const nextTotal = Math.max(0, (prev.totalUnread || 0) - cleared);
          if (cleared > 0) {
            setUnreadCountsLocal({ unreadDirect: nextTotal, unreadAnnouncements: 0 });
          }
          return {
            ...prev,
            students: nextStudents,
            totalUnread: nextTotal,
          };
        });
      } catch (err) {
        if (!silent) toast.error(err?.message || 'Failed to open student conversation');
      } finally {
        if (!silent) setLoadingThread(false);
      }
    },
    [setUnreadCountsLocal, toast]
  );

  const loadGroupAnnouncements = useCallback(
    async (groupId, silent = false) => {
      if (!groupId) return;
      if (!silent) setLoadingGroupAnns(true);
      try {
        const res = await api.getAdvisorGroupAnnouncements(groupId);
        setGroupAnns(res?.announcements || []);
      } catch (err) {
        if (!silent) toast.error(err?.message || 'Failed to load group announcements');
      } finally {
        if (!silent) setLoadingGroupAnns(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    loadInbox(false);
  }, [loadInbox]);

  useEffect(() => {
    if (selectedGroupId !== 'all') {
      setAnnGroupId(Number(selectedGroupId));
    } else if (!annGroupId && inbox.groups.length > 0) {
      setAnnGroupId(inbox.groups[0].id);
    }
  }, [selectedGroupId, annGroupId, inbox.groups]);

  useEffect(() => {
    if (panelMode === 'dialogs' && selectedStudentUsername) {
      loadStudentThread(selectedStudentUsername, false);
    }
  }, [panelMode, selectedStudentUsername, loadStudentThread]);

  useEffect(() => {
    if (panelMode === 'announcements' && annGroupId) {
      loadGroupAnnouncements(annGroupId, false);
    }
  }, [panelMode, annGroupId, loadGroupAnnouncements]);

  // Live 2.5s sync refresh while advisor is on /messages
  useEffect(() => {
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadInbox(true);
      if (panelMode === 'dialogs' && selectedStudentUsername) {
        loadStudentThread(selectedStudentUsername, true);
      } else if (panelMode === 'announcements' && annGroupId) {
        loadGroupAnnouncements(annGroupId, true);
      }
    };
    const timer = setInterval(tick, 2500);
    return () => clearInterval(timer);
  }, [panelMode, selectedStudentUsername, annGroupId, syncVersion, loadInbox, loadStudentThread, loadGroupAnnouncements]);

  const threadMsgCount = thread?.messages?.length || 0;
  useEffect(() => {
    if (panelMode === 'dialogs' && threadMsgCount !== prevThreadMsgCountRef.current) {
      prevThreadMsgCountRef.current = threadMsgCount;
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [panelMode, threadMsgCount]);

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (inbox.students || []).filter((s) => {
      if (selectedGroupId !== 'all' && Number(s.groupId) !== Number(selectedGroupId)) {
        return false;
      }
      if (!q) return true;
      const hay = `${s.display_name || ''} ${s.username || ''} ${s.groupName || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [inbox.students, selectedGroupId, searchQuery]);

  const handleSendReply = async (e) => {
    if (e) e.preventDefault();
    const text = replyDraft.trim();
    if (!text || !selectedStudentUsername || sendingReply) return;

    setSendingReply(true);
    try {
      const res = await api.sendAdvisorMessage(selectedStudentUsername, text);
      setReplyDraft('');
      if (res?.message) {
        setThread((prev) =>
          prev
            ? {
                ...prev,
                messages: [...(prev.messages || []), res.message],
              }
            : prev
        );
      }
      loadInbox(true);
      refreshCountsNow();
    } catch (err) {
      toast.error(err?.message || 'Failed to send reply');
    } finally {
      setSendingReply(false);
    }
  };

  const handleReplyKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendReply();
    }
  };

  const handleSendAnnouncement = async (e) => {
    if (e) e.preventDefault();
    const text = annDraft.trim();
    if (!text || !annGroupId || sendingAnn) return;

    setSendingAnn(true);
    try {
      const res = await api.sendAdvisorGroupAnnouncement(annGroupId, text);
      setAnnDraft('');
      if (res?.announcement) {
        setGroupAnns((prev) => [res.announcement, ...(prev || [])]);
      }
      toast.success('Announcement broadcast to group!');
    } catch (err) {
      toast.error(err?.message || 'Failed to broadcast announcement');
    } finally {
      setSendingAnn(false);
    }
  };

  const activeSnap = thread?.academicSnapshot;
  const currentAnnGroup = inbox.groups.find((g) => Number(g.id) === Number(annGroupId)) || null;

  return (
    <div className="msg-shell msg-shell-advisor">
      {/* Left Sidebar: Groups, Mode Switcher, and Sorted Student List */}
      <aside className="msg-sidebar msg-sidebar-wide">
        <div className="msg-sidebar-header">
          <div>
            <h2 className="msg-sidebar-title">
              Advisor Inbox
              {inbox.totalUnread > 0 && (
                <span className="msg-unread-badge" style={{ marginLeft: 8 }}>
                  {inbox.totalUnread}
                </span>
              )}
            </h2>
            <p className="msg-sidebar-sub">Assigned groups, dialogs & academic snapshots</p>
          </div>
          <button
            type="button"
            className="btn btn-mini"
            onClick={() => navigate('/profile')}
            title="Configure Office Hours & Availability"
          >
            🕒 Office Hours
          </button>
        </div>

        {/* Group Filter Chips */}
        {inbox.groups.length > 0 && (
          <div className="msg-group-chips">
            <button
              type="button"
              className={`msg-group-chip ${selectedGroupId === 'all' ? 'is-active' : ''}`}
              onClick={() => setSelectedGroupId('all')}
            >
              All Groups ({inbox.students.length})
            </button>
            {inbox.groups.map((g) => (
              <button
                key={g.id}
                type="button"
                className={`msg-group-chip ${Number(selectedGroupId) === Number(g.id) ? 'is-active' : ''}`}
                onClick={() => setSelectedGroupId(g.id)}
              >
                <span>{g.name}</span>
                {g.unreadCount > 0 && <span className="msg-chip-badge">{g.unreadCount}</span>}
              </button>
            ))}
          </div>
        )}

        {/* Mode Switcher */}
        <div className="msg-mode-tabs">
          <button
            type="button"
            className={`msg-mode-tab ${panelMode === 'dialogs' ? 'is-active' : ''}`}
            onClick={() => setPanelMode('dialogs')}
          >
            💬 Student Dialogs
          </button>
          <button
            type="button"
            className={`msg-mode-tab ${panelMode === 'announcements' ? 'is-active' : ''}`}
            onClick={() => setPanelMode('announcements')}
          >
            📢 Group Announcements
          </button>
        </div>

        {panelMode === 'dialogs' ? (
          <>
            <div className="msg-search-box">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search student by name, login, or group…"
              />
            </div>

            <div className="msg-student-list">
              {loadingInbox ? (
                <p className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>
                  Loading assigned students…
                </p>
              ) : inbox.groups.length === 0 ? (
                <div style={{ padding: '1.25rem', textAlign: 'center' }}>
                  <p style={{ fontWeight: 700, color: '#002B49', marginBottom: 4 }}>No Assigned Groups</p>
                  <p className="muted small" style={{ margin: 0 }}>
                    An administrator has not assigned any study groups to your advisor account yet.
                  </p>
                </div>
              ) : filteredStudents.length === 0 ? (
                <p className="muted small" style={{ padding: '1rem', textAlign: 'center' }}>
                  No students match your filter.
                </p>
              ) : (
                filteredStudents.map((s) => {
                  const isSelected =
                    selectedStudentUsername &&
                    selectedStudentUsername.toLowerCase() === s.username.toLowerCase();
                  const snap = s.academicSnapshot || {};

                  return (
                    <button
                      key={s.username}
                      type="button"
                      className={`msg-student-row ${isSelected ? 'is-active' : ''} ${s.unreadCount > 0 ? 'has-unread' : ''}`}
                      onClick={() => {
                        setSelectedStudentUsername(s.username);
                        setPanelMode('dialogs');
                      }}
                    >
                      <div className="msg-student-row-top">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                          <AvatarCircle
                            name={s.display_name || s.username}
                            avatarUrl={s.avatar_url}
                            size={36}
                            bg="#002B49"
                          />
                          <div style={{ minWidth: 0, textAlign: 'left' }}>
                            <div className="msg-student-name">
                              {s.display_name || s.username}
                            </div>
                            <div className="msg-student-login">
                              @{s.username} · <span className="msg-mini-group">{s.groupName}</span>
                            </div>
                          </div>
                        </div>
                        {s.unreadCount > 0 && (
                          <span className="msg-unread-badge">{s.unreadCount}</span>
                        )}
                      </div>

                      {s.lastMessage && (
                        <div className="msg-student-preview">
                          <span>
                            {s.lastMessage.isMine ? 'You: ' : ''}
                            {s.lastMessage.preview}
                          </span>
                          <span className="msg-preview-time">
                            {formatDateTime(s.lastMessage.createdAt)}
                          </span>
                        </div>
                      )}

                      <div className="msg-snapshot-pills">
                        <span>GPA: <strong>{snap.gpaFormatted || '—'}</strong></span>
                        <span>Load: <strong>{snap.semesterLoadEcts ?? 0} ECTS</strong></span>
                        <span>Recs: <strong>{snap.lastRecommendationAt ? formatShortDate(snap.lastRecommendationAt) : '—'}</strong></span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div className="msg-student-list" style={{ padding: '0.75rem' }}>
            <p className="small muted" style={{ margin: '0 0 0.6rem 0', fontWeight: 600 }}>
              Select a group to view or publish announcements:
            </p>
            {inbox.groups.length === 0 ? (
              <p className="muted small">No groups assigned.</p>
            ) : (
              inbox.groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={`msg-channel-item ${Number(annGroupId) === Number(g.id) ? 'is-active' : ''}`}
                  onClick={() => setAnnGroupId(g.id)}
                  style={{ marginBottom: 6 }}
                >
                  <div className="msg-avatar" style={{ width: 36, height: 36, backgroundColor: '#0070BA' }}>
                    <span>📢</span>
                  </div>
                  <div className="msg-channel-meta">
                    <div className="msg-channel-top">
                      <span className="msg-channel-name">{g.name}</span>
                      <span className="muted small">{g.memberCount} students</span>
                    </div>
                    <div className="msg-channel-sub">
                      {g.program} · Year {g.study_year}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </aside>

      {/* Right Main Panel */}
      <section className="msg-main">
        {panelMode === 'dialogs' ? (
          !selectedStudentUsername ? (
            <div className="msg-empty-state">
              <h3>Select a Student Conversation</h3>
              <p className="muted">
                Choose a student from your assigned groups on the left to review their read-only academic snapshot and reply to messages.
              </p>
            </div>
          ) : loadingThread && !thread ? (
            <div className="msg-empty-state">
              <p className="muted">Loading student thread…</p>
            </div>
          ) : thread ? (
            <>
              <header className="msg-chat-header">
                <div className="msg-chat-header-main">
                  <AvatarCircle
                    name={thread.student?.display_name || thread.student?.username}
                    avatarUrl={thread.student?.avatar_url}
                    size={44}
                    bg="#002B49"
                  />
                  <div className="msg-chat-header-info">
                    <div className="msg-chat-title-row">
                      <span className="msg-chat-title">
                        {thread.student?.display_name || thread.student?.username}
                      </span>
                      <span className="muted small">@{thread.student?.username}</span>
                      <PresenceBadge presence={thread.student?.presence} />
                    </div>
                    <div className="msg-chat-subtitle">
                      Group {thread.student?.groupName} · {thread.student?.program} (Year {thread.student?.studyYear})
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowSnapshotModal(true)}
                    style={{ marginLeft: 'auto', fontWeight: 600 }}
                  >
                    📊 Academic Snapshot
                  </button>
                </div>

                {/* Read-Only Academic Snapshot Bar (US27) */}
                {activeSnap && (
                  <div className="msg-snapshot-banner">
                    <span className="msg-readonly-tag">READ-ONLY SNAPSHOT</span>
                    <span>
                      GPA: <strong>{activeSnap.gpaFormatted}</strong>
                    </span>
                    <span>
                      Current Load: <strong>{activeSnap.semesterLoadEcts} ECTS</strong> ({activeSnap.plannedCoursesCount} courses)
                    </span>
                    <span>
                      Last Recommendation: <strong>{formatShortDate(activeSnap.lastRecommendationAt)}</strong>
                    </span>
                  </div>
                )}
              </header>

              <div className="msg-stream">
                {(thread.messages || []).length === 0 ? (
                  <div className="msg-empty-thread">
                    <p style={{ fontWeight: 700, color: '#002B49', marginBottom: 4 }}>
                      No messages with {thread.student?.display_name || thread.student?.username} yet
                    </p>
                    <p className="muted small" style={{ margin: 0 }}>
                      Send a message below to start advising this student.
                    </p>
                  </div>
                ) : (
                  thread.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`msg-bubble-row ${m.isMine ? 'is-mine' : 'is-theirs'}`}
                    >
                      <div className={`msg-bubble ${m.isMine ? 'bubble-mine' : 'bubble-theirs'}`}>
                        <div className="msg-bubble-content">{m.content}</div>
                        <div className="msg-bubble-meta">
                          <span>{formatDateTime(m.createdAt)}</span>
                          {m.isMine && (
                            <span className="msg-read-flag">
                              {m.isRead ? '· Read ✓✓' : '· Sent ✓'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              <form className="msg-composer" onSubmit={handleSendReply}>
                <div className="msg-emoji-bar">
                  {QUICK_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      className="msg-emoji-btn"
                      onClick={() => setReplyDraft((prev) => (prev.length < 1998 ? `${prev}${em}` : prev))}
                      title={`Insert ${em}`}
                    >
                      {em}
                    </button>
                  ))}
                  <span className="msg-char-counter">{replyDraft.length} / 2000</span>
                </div>
                <div className="msg-composer-row">
                  <textarea
                    value={replyDraft}
                    onChange={(e) => setReplyDraft(e.target.value)}
                    onKeyDown={handleReplyKeyDown}
                    maxLength={2000}
                    rows={2}
                    placeholder={`Reply to ${thread.student?.display_name || thread.student?.username}... (Enter to send, Shift+Enter for new line)`}
                    disabled={sendingReply}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary msg-send-btn"
                    disabled={!replyDraft.trim() || sendingReply}
                  >
                    {sendingReply ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            </>
          ) : null
        ) : (
          /* Advisor Group Announcements Broadcast Panel (US29) */
          <>
            <header className="msg-chat-header">
              <div className="msg-chat-header-main">
                <div className="msg-avatar" style={{ width: 44, height: 44, backgroundColor: '#0070BA' }}>
                  <span>📢</span>
                </div>
                <div className="msg-chat-header-info">
                  <div className="msg-chat-title-row">
                    <span className="msg-chat-title">
                      {currentAnnGroup
                        ? `Group ${currentAnnGroup.name} — Announcements`
                        : 'Group Announcements'}
                    </span>
                    <span className="msg-ann-badge">Broadcast</span>
                  </div>
                  <div className="msg-chat-subtitle">
                    {currentAnnGroup
                      ? `${currentAnnGroup.program} · Year ${currentAnnGroup.study_year} · ${currentAnnGroup.memberCount} enrolled students`
                      : 'Select an assigned group to broadcast announcements'}
                  </div>
                </div>
              </div>
            </header>

            <div className="msg-stream">
              {currentAnnGroup && (
                <form className="msg-ann-compose-card" onSubmit={handleSendAnnouncement}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <strong style={{ color: '#002B49', fontSize: 13.5 }}>
                      New Announcement to {currentAnnGroup.name}
                    </strong>
                    <span className="msg-char-counter">{annDraft.length} / 2000</span>
                  </div>
                  <textarea
                    value={annDraft}
                    onChange={(e) => setAnnDraft(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="e.g. Group advising meeting on Friday at 14:00 in Room F-302. Please review your semester course plan beforehand."
                    disabled={sendingAnn}
                    style={{ width: '100%', resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 8 }}>
                    <div className="msg-emoji-bar" style={{ margin: 0 }}>
                      {QUICK_EMOJIS.map((em) => (
                        <button
                          key={em}
                          type="button"
                          className="msg-emoji-btn"
                          onClick={() => setAnnDraft((prev) => (prev.length < 1998 ? `${prev}${em}` : prev))}
                        >
                          {em}
                        </button>
                      ))}
                    </div>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={!annDraft.trim() || sendingAnn}
                    >
                      {sendingAnn ? 'Sending…' : 'Send Announcement'}
                    </button>
                  </div>
                </form>
              )}

              {loadingGroupAnns ? (
                <p className="muted" style={{ textAlign: 'center', marginTop: '1.5rem' }}>
                  Loading group announcements…
                </p>
              ) : groupAnns.length === 0 ? (
                <div className="msg-empty-thread">
                  <p style={{ fontWeight: 700, color: '#002B49', marginBottom: 4 }}>
                    No Announcements Sent Yet
                  </p>
                  <p className="muted small" style={{ margin: 0 }}>
                    Broadcast messages sent to this group will display live delivery and student read statistics here.
                  </p>
                </div>
              ) : (
                groupAnns.map((ann) => (
                  <article key={ann.id} className="msg-ann-card">
                    <div className="msg-ann-card-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="msg-ann-badge">{ann.badge || 'Announcement'}</span>
                        <strong style={{ color: '#002B49', fontSize: 13.5 }}>Group {ann.groupName}</strong>
                      </div>
                      <span className="muted small">{formatDateTime(ann.createdAt)}</span>
                    </div>
                    <div className="msg-ann-card-body">{ann.content}</div>
                    <div className="msg-ann-card-footer">
                      <div className="msg-delivery-stats">
                        <span>Delivered: <strong>{ann.deliveredCount}</strong></span>
                        <span style={{ color: '#00A859' }}>
                          Read: <strong>{ann.readCount} / {ann.deliveredCount}</strong>
                        </span>
                        {ann.unreadCount > 0 && (
                          <span className="muted">Pending: {ann.unreadCount}</span>
                        )}
                      </div>
                      {Array.isArray(ann.readers) && ann.readers.length > 0 && (
                        <span className="muted small">
                          Read by: {ann.readers.map((r) => r.username).join(', ')}
                        </span>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          </>
        )}
      </section>

      {/* Read-Only Academic Snapshot Modal (US27) */}
      {showSnapshotModal && thread && activeSnap && (
        <div className="msg-modal-backdrop" onClick={() => setShowSnapshotModal(false)}>
          <div className="msg-modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: '#002B49' }}>
                  Student Academic Snapshot
                </h3>
                <div className="muted small">
                  {thread.student?.display_name || thread.student?.username} (@{thread.student?.username}) · Group {thread.student?.groupName}
                </div>
              </div>
              <span className="msg-readonly-tag">READ-ONLY</span>
            </div>

            <div className="msg-snapshot-grid">
              <div className="msg-snapshot-metric">
                <span className="muted small">Cumulative GPA</span>
                <strong>{activeSnap.gpaFormatted}</strong>
              </div>
              <div className="msg-snapshot-metric">
                <span className="muted small">Current Semester Load</span>
                <strong>{activeSnap.semesterLoadEcts} ECTS</strong>
              </div>
              <div className="msg-snapshot-metric">
                <span className="muted small">Planned / Registered Courses</span>
                <strong>{activeSnap.plannedCoursesCount}</strong>
              </div>
              <div className="msg-snapshot-metric">
                <span className="muted small">Completed Credits</span>
                <strong>{activeSnap.completedEcts != null ? `${activeSnap.completedEcts} ECTS` : '—'}</strong>
              </div>
              <div className="msg-snapshot-metric">
                <span className="muted small">Current Term</span>
                <strong>{activeSnap.currentTerm || '—'}</strong>
              </div>
              <div className="msg-snapshot-metric">
                <span className="muted small">Last Recommendation Activity</span>
                <strong>{formatShortDate(activeSnap.lastRecommendationAt)}</strong>
              </div>
            </div>

            <p className="muted small" style={{ marginTop: '0.9rem', marginBottom: '1rem' }}>
              This academic summary is strictly read-only to support fast advising context. Students remain in control of editing their own schedule plans.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-primary" onClick={() => setShowSnapshotModal(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MessagesPage() {
  const navigate = useNavigate();
  const { me, profile } = useAuthStore();
  const role = profile?.role || (me?.demo ? 'Student' : 'Student');

  if (me?.demo) {
    return (
      <main className="page">
        <div className="card" style={{ maxWidth: 560, margin: '2rem auto', padding: '1.5rem', textAlign: 'center' }}>
          <h2 style={{ color: '#002B49' }}>Advisor Messaging Unavailable in Demo Mode</h2>
          <p className="muted">Please sign in with an SDU account to use live advisor chat and group announcements.</p>
          <button className="btn btn-primary" onClick={() => navigate('/')}>← Back to Planner</button>
        </div>
      </main>
    );
  }

  if (role === 'Advisor') {
    return (
      <main className="page">
        <AdvisorMessagesView />
      </main>
    );
  }

  if (role === 'Student') {
    return (
      <main className="page">
        <StudentMessagesView />
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card" style={{ maxWidth: 580, margin: '2rem auto', padding: '1.5rem', textAlign: 'center' }}>
        <h2 style={{ color: '#002B49' }}>Group & Advisor Assignments</h2>
        <p className="muted">
          Direct advisor consultations and group channels are available to Students and Academic Advisors. Manage group assignments in the Admin Panel.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/admin')}>
          Open Admin Panel →
        </button>
      </div>
    </main>
  );
}
