import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuthStore } from '../stores/authStore.js';
import EligibilityBadge from '../shared/ui/EligibilityBadge.jsx';

const QUICK_PROMPTS = [
  'What courses am I eligible for next semester?',
  'Which courses are prioritized for me to take?',
  'What is in my current schedule right now?',
  'What is my current GPA and completed credits?',
];

function renderInline(text) {
  const segments = String(text || '').split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return segments.map((seg, segIdx) => {
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      return <strong key={segIdx}>{seg.slice(2, -2)}</strong>;
    }
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length > 2) {
      return <code key={segIdx} className="ai-chat-inline-code">{seg.slice(1, -1)}</code>;
    }
    return <React.Fragment key={segIdx}>{seg}</React.Fragment>;
  });
}

function renderFormattedText(text) {
  if (!text) return null;
  const lines = String(text).split('\n');
  const blocks = [];
  let listType = null;
  let listItems = [];

  const flushList = (keyPrefix) => {
    if (!listType || listItems.length === 0) return;
    const Tag = listType;
    blocks.push(
      <Tag key={`${keyPrefix}-list`} className="ai-chat-list">
        {listItems.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </Tag>
    );
    listType = null;
    listItems = [];
  };

  lines.forEach((line, idx) => {
    const bulletMatch = line.match(/^\s*[-*•]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);

    if (bulletMatch) {
      if (listType === 'ol') flushList(idx);
      listType = 'ul';
      listItems.push(bulletMatch[1]);
    } else if (orderedMatch) {
      if (listType === 'ul') flushList(idx);
      listType = 'ol';
      listItems.push(orderedMatch[1]);
    } else {
      flushList(idx);
      if (line.trim() === '') {
        blocks.push(<div key={`${idx}-sp`} className="ai-chat-spacer" />);
      } else {
        blocks.push(<div key={`${idx}-p`}>{renderInline(line)}</div>);
      }
    }
  });
  flushList('end');
  return blocks;
}

function SparkleIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

export default function AiAssistantChat() {
  const navigate = useNavigate();
  const { me, profile } = useAuthStore();
  const currentUsername = profile?.username || me?.user?.username || me?.username;

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [addingCode, setAddingCode] = useState(null);
  const [addedCodes, setAddedCodes] = useState(() => new Set());
  const [removedCodes, setRemovedCodes] = useState(() => new Set());

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Clear local chat state when user switches accounts or logs out
  useEffect(() => {
    setMessages([]);
    setAddedCodes(new Set());
    setRemovedCodes(new Set());
    setInputMessage('');
    setErrorMessage(null);
  }, [currentUsername]);

  // Load chat history + sync live plan state when the chat window opens
  useEffect(() => {
    if (isOpen && currentUsername) {
      setLoadingHistory(true);
      setErrorMessage(null);
      Promise.all([
        api.getChatMessages(),
        api.getSavedPlan().catch(() => null),
      ])
        .then(([chatRes, planRes]) => {
          const loadedMsgs = chatRes.messages || [];
          setMessages(loadedMsgs);
          if (planRes && 'plan' in planRes) {
            const liveCourses = Array.isArray(planRes.plan?.courses) ? planRes.plan.courses : [];
            const inPlanSet = new Set(liveCourses.map((c) => String(c.code || '').toUpperCase().trim()));
            setAddedCodes(inPlanSet);
            const nextRemoved = new Set();
            for (const m of loadedMsgs) {
              for (const card of m.courseCards || []) {
                if (!inPlanSet.has(card.code)) nextRemoved.add(card.code);
              }
            }
            setRemovedCodes(nextRemoved);
          }
          setLoadingHistory(false);
        })
        .catch((err) => {
          console.error('[AiAssistantChat] Failed to load messages:', err);
          setLoadingHistory(false);
        });
    }
  }, [isOpen, currentUsername]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isTyping, isOpen]);

  // Auto-grow composer textarea smoothly with long input (up to ~6 lines)
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = 132;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(nextHeight, 24)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [inputMessage, isOpen]);

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  const sendText = async (rawText) => {
    const trimmed = String(rawText || '').trim();
    if (!trimmed || isTyping) return;

    // Check if offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorMessage('No connection, try again');
      return; // Keeps the unsent message in input field
    }

    const optimisticUserMsg = {
      id: 'temp-' + Date.now(),
      sender: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    // Optimistically show user message, keep input in case of failure
    setMessages((prev) => [...prev, optimisticUserMsg]);
    setIsTyping(true);
    setErrorMessage(null);

    try {
      const res = await api.sendChatMessage(trimmed);
      // On success, clear input and replace with authoritative messages
      setInputMessage('');
      if (res.assistantMessage) {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== optimisticUserMsg.id),
          res.userMessage || optimisticUserMsg,
          res.assistantMessage,
        ]);
      }
      setIsTyping(false);
    } catch (err) {
      console.error('[AiAssistantChat] Send error:', err);
      // Rollback optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
      setIsTyping(false);
      // Show specific server validation message on HTTP 4xx/5xx; show offline banner on connection failures
      const isNetworkError = !err?.status || (typeof navigator !== 'undefined' && !navigator.onLine);
      setErrorMessage(isNetworkError ? 'No connection, try again' : (err.message || 'Failed to send message'));
    }
  };

  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    await sendText(inputMessage);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    const onPlanUpdated = (e) => {
      const nextCourses = Array.isArray(e?.detail?.courses) ? e.detail.courses : [];
      const inPlanSet = new Set(nextCourses.map((c) => String(c.code || '').toUpperCase().trim()));
      setAddedCodes(inPlanSet);
      setRemovedCodes((prev) => {
        const next = new Set(prev);
        for (const msg of messages) {
          for (const card of msg.courseCards || []) {
            if (!inPlanSet.has(card.code)) next.add(card.code);
            else next.delete(card.code);
          }
        }
        return next;
      });
    };
    window.addEventListener('zeme:plan-updated', onPlanUpdated);
    return () => window.removeEventListener('zeme:plan-updated', onPlanUpdated);
  }, [messages]);

  const handleClearHistory = async () => {
    try {
      await api.clearChatMessages();
      setMessages([]);
      setAddedCodes(new Set());
      setRemovedCodes(new Set());
    } catch (err) {
      console.error('[AiAssistantChat] Clear error:', err);
    }
  };

  const handleAddCourseToPlan = async (courseCode) => {
    if (!courseCode || addingCode) return;
    setAddingCode(courseCode);
    setErrorMessage(null);
    try {
      const res = await api.addChatCourseToPlan(courseCode);
      setAddedCodes((prev) => {
        const next = new Set(prev);
        next.add(courseCode);
        return next;
      });
      setRemovedCodes((prev) => {
        const next = new Set(prev);
        next.delete(courseCode);
        return next;
      });
      if (res.confirmationMessage) {
        setMessages((prev) => [...prev, res.confirmationMessage]);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('zeme:plan-updated', { detail: res.plan }));
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to add course to plan');
    } finally {
      setAddingCode(null);
    }
  };

  const handleRemoveCourseFromPlan = async (courseCode) => {
    if (!courseCode || addingCode) return;
    setAddingCode(courseCode);
    setErrorMessage(null);
    try {
      const res = await api.removeChatCourseFromPlan(courseCode);
      setAddedCodes((prev) => {
        const next = new Set(prev);
        next.delete(courseCode);
        return next;
      });
      setRemovedCodes((prev) => {
        const next = new Set(prev);
        next.add(courseCode);
        return next;
      });
      if (res.confirmationMessage) {
        setMessages((prev) => [...prev, res.confirmationMessage]);
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('zeme:plan-updated', { detail: res.plan }));
      }
    } catch (err) {
      setErrorMessage(err.message || 'Failed to remove course from plan');
    } finally {
      setAddingCode(null);
    }
  };

  const formatTime = (isoString) => {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <>
      {/* Floating Assistant Button */}
      <button
        type="button"
        className={`ai-chat-floating-btn ${isOpen ? 'active' : ''}`}
        onClick={handleToggle}
        aria-label="Open AI Assistant Chat"
        title="Open AI Assistant Chat"
      >
        <span className="ai-chat-btn-icon">
          <SparkleIcon size={17} />
        </span>
        <span className="ai-chat-btn-text">{isOpen ? 'Close Chat' : 'AI Assistant'}</span>
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="ai-chat-window" role="dialog" aria-label="AI Academic Assistant">
          {/* Header */}
          <div className="ai-chat-header">
            <div className="ai-chat-header-left">
              <div className="ai-chat-avatar">
                <SparkleIcon size={18} />
              </div>
              <div className="ai-chat-header-info">
                <div className="ai-chat-title">
                  AI Academic Assistant
                  <span className="ai-chat-status-dot" title="Online" />
                </div>
                <div className="ai-chat-subtitle">SDU Curriculum & Study Advisor</div>
              </div>
            </div>
            <div className="ai-chat-header-actions">
              {messages.length > 0 && (
                <button
                  type="button"
                  className="ai-chat-clear-btn"
                  onClick={handleClearHistory}
                  title="Clear conversation history"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                className="ai-chat-close-btn"
                onClick={handleToggle}
                aria-label="Close Chat"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="ai-chat-error-banner">
              <span>{errorMessage}</span>
              <button type="button" onClick={() => setErrorMessage(null)}>✕</button>
            </div>
          )}

          {/* Messages Body */}
          <div className="ai-chat-body">
            {loadingHistory ? (
              <div className="ai-chat-loading">Loading conversation history…</div>
            ) : messages.length === 0 ? (
              <div className="ai-chat-empty">
                <div className="ai-chat-empty-badge">
                  <SparkleIcon size={26} />
                </div>
                <div className="ai-chat-empty-title">Ask your AI Academic Advisor</div>
                <div className="ai-chat-empty-desc">
                  Get instant answers grounded in your SDU transcript, curriculum roadmap, and prerequisite rules.
                </div>
                <div className="ai-chat-prompts">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="ai-chat-prompt-chip"
                      onClick={() => sendText(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={msg.id || idx}
                  className={`ai-chat-bubble-row ${msg.sender === 'user' ? 'user-row' : 'assistant-row'}`}
                >
                  {msg.sender === 'assistant' && (
                    <div className="ai-chat-msg-avatar" aria-hidden="true">
                      <SparkleIcon size={13} />
                    </div>
                  )}
                  <div className={`ai-chat-bubble ${msg.sender === 'user' ? 'user-bubble' : 'assistant-bubble'}`}>
                    <div className="ai-chat-bubble-text">
                      {msg.sender === 'assistant' ? renderFormattedText(msg.content) : msg.content}
                    </div>
                    {msg.sender === 'assistant' && Array.isArray(msg.courseCards) && msg.courseCards.length > 0 && (
                      <div className="ai-chat-cards">
                        {msg.courseCards.map((card) => {
                          const isPlaceholder = Boolean(card.isElectivePlaceholder || /^XXX/i.test(card.code));
                          const isAdded = !isPlaceholder && ((card.alreadyInPlan && !removedCodes.has(card.code)) || addedCodes.has(card.code));
                          const isBusy = addingCode === card.code;
                          const isDisabled =
                            isBusy ||
                            isPlaceholder ||
                            (!isAdded && (!card.eligible || card.alreadyCompleted || card.currentlyTaking));
                          const btnLabel = isBusy
                            ? (isAdded ? 'Removing…' : 'Adding…')
                            : isPlaceholder
                              ? 'Select Elective'
                              : card.alreadyCompleted
                                ? 'Completed ✓'
                                : card.currentlyTaking
                                  ? 'In Progress ✓'
                                  : isAdded
                                    ? 'Remove from plan'
                                    : 'Add to my plan';

                          const detailsUrl = isPlaceholder
                            ? `/electives/${encodeURIComponent(card.code)}${card.mufSqId ? `?mufSqId=${encodeURIComponent(card.mufSqId)}` : ''}`
                            : `/courses/${encodeURIComponent(card.code)}${card.mufSqId ? `?mufSqId=${encodeURIComponent(card.mufSqId)}` : ''}`;

                          return (
                            <div
                              key={card.code}
                              className={`ai-chat-course-card ${card.eligible ? 'card-eligible' : 'card-ineligible'}`}
                            >
                              <div className="ai-chat-card-top">
                                <div className="ai-chat-card-code-wrap">
                                  <span className="ai-chat-card-code">{card.code}</span>
                                  <span className="ai-chat-card-ects">{card.ects} ECTS</span>
                                </div>
                                <EligibilityBadge
                                  status={card.eligibilityStatus || (card.eligible ? 'eligible' : 'not_eligible')}
                                  missingCount={card.missingPrerequisites?.length || 0}
                                />
                              </div>
                              <div className="ai-chat-card-name">{card.name}</div>
                              {!card.eligible && Array.isArray(card.missingPrerequisites) && card.missingPrerequisites.length > 0 && (
                                <div className="ai-chat-card-missing">
                                  Missing: {card.missingPrerequisites.map((m) => `${m.code} (min ${m.minGrade})`).join(', ')}
                                </div>
                              )}
                              <div className="ai-chat-card-actions">
                                <button
                                  type="button"
                                  className="btn btn-mini ai-chat-card-view"
                                  onClick={() => navigate(detailsUrl)}
                                >
                                  Details →
                                </button>
                                <button
                                  type="button"
                                  className={`btn btn-mini ${isAdded ? 'ai-chat-card-remove' : 'ai-chat-card-add'}`}
                                  disabled={isDisabled}
                                  onClick={() => (isAdded ? handleRemoveCourseFromPlan(card.code) : handleAddCourseToPlan(card.code))}
                                >
                                  {btnLabel}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {msg.sender === 'assistant' && Array.isArray(msg.links) && msg.links.length > 0 && (() => {
                      const cardCodesSet = new Set((msg.courseCards || []).map((c) => c.code));
                      const filteredLinks = msg.links.filter((l) => l.type !== 'course' || !cardCodesSet.has(l.code));
                      if (filteredLinks.length === 0) return null;
                      return (
                        <div className="ai-chat-links">
                          {filteredLinks.map((link, lIdx) => (
                            <button
                              key={link.url || lIdx}
                              type="button"
                              className={`ai-chat-link-pill ${link.type === 'course' ? 'course-link' : 'page-link'}`}
                              onClick={() => navigate(link.url)}
                              title={`Open ${link.label}`}
                            >
                              {link.type === 'course' && (
                                <span
                                  className={`ai-chat-link-dot ${link.eligible === false ? 'dot-blocked' : 'dot-ok'}`}
                                />
                              )}
                              <span className="ai-chat-link-label">{link.label}</span>
                              <span className="ai-chat-link-arrow">→</span>
                            </button>
                          ))}
                        </div>
                      );
                    })()}
                    <div className="ai-chat-bubble-time">{formatTime(msg.created_at)}</div>
                  </div>
                </div>
              ))
            )}

            {/* Typing Indicator */}
            {isTyping && (
              <div className="ai-chat-bubble-row assistant-row">
                <div className="ai-chat-msg-avatar" aria-hidden="true">
                  <SparkleIcon size={13} />
                </div>
                <div className="ai-chat-bubble assistant-bubble typing-bubble">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-text">AI Assistant is thinking…</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Footer Input Area */}
          <form className="ai-chat-footer" onSubmit={handleSendMessage}>
            <div className="ai-chat-composer">
              <textarea
                ref={textareaRef}
                className="ai-chat-textarea"
                placeholder="Ask about courses, prerequisites, GPA…"
                rows={1}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isTyping}
              />
              <button
                type="submit"
                className="ai-chat-send-btn"
                disabled={!inputMessage.trim() || isTyping}
                aria-label="Send message"
                title="Send message (Enter)"
              >
                <SendIcon />
              </button>
            </div>
            <div className="ai-chat-hint">Enter to send · Shift+Enter for new line</div>
          </form>
        </div>
      )}
    </>
  );
}
