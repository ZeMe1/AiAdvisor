import crypto from 'node:crypto';
import { chatRepository } from '../repositories/chat.repository.mjs';
import { groupRepository } from '../repositories/group.repository.mjs';
import { userRepository } from '../repositories/user.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export const LOG_RETENTION_DAYS = 365;

const REFUSAL_TEXT_PATTERN =
  /i can only (assist|help) with academic|могу отвечать только на академические|cannot store, process, or repeat passwords|не обрабатываю, не сохраняю и не повторяю пароли/i;

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function anonymizeUsername(username) {
  const digest = crypto
    .createHash('sha256')
    .update(`zeme-us25-anon:${String(username || '').trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 6)
    .toUpperCase();
  return `Student #${digest}`;
}

function scrubIdentityFromText(text, anonId, tokens = []) {
  let out = String(text || '');
  for (const token of tokens) {
    const clean = String(token || '').trim();
    if (clean.length < 2) continue;
    const re = new RegExp(escapeRegExp(clean), 'gi');
    out = out.replace(re, anonId);
  }
  return out;
}

export class AssistantLogsService {
  async buildLookups() {
    const [groups, users] = await Promise.all([
      groupRepository.listGroups().catch(() => []),
      userRepository.listAllUsers().catch(() => []),
    ]);

    const memberLists = await Promise.all(
      (groups || []).map(async (g) => {
        const members = await groupRepository.listGroupMembers(g.id).catch(() => []);
        return { groupName: g.name, members: members || [] };
      })
    );

    const userGroupMap = new Map();
    for (const { groupName, members } of memberLists) {
      for (const m of members) {
        if (m?.username) {
          userGroupMap.set(String(m.username).toLowerCase(), groupName);
        }
      }
    }

    const userDisplayMap = new Map();
    for (const u of users || []) {
      if (u?.username) {
        userDisplayMap.set(String(u.username).toLowerCase(), u.display_name || '');
      }
    }

    const availableGroups = Array.from(new Set((groups || []).map((g) => g.name).filter(Boolean))).sort();
    return { userGroupMap, userDisplayMap, availableGroups };
  }

  pairConversations(messages, reviews, userGroupMap, userDisplayMap) {
    const reviewByMsgId = new Map();
    for (const r of reviews || []) {
      reviewByMsgId.set(Number(r.message_id), r);
    }

    const byUser = new Map();
    for (const m of messages || []) {
      const key = String(m.username || '').toLowerCase();
      if (!byUser.has(key)) byUser.set(key, []);
      byUser.get(key).push(m);
    }

    const entries = [];
    for (const [unameLower, list] of byUser.entries()) {
      const sorted = [...list].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || Number(a.id) - Number(b.id)
      );
      const anonId = anonymizeUsername(unameLower);
      const groupName = userGroupMap.get(unameLower) || 'Unassigned';
      const displayName = userDisplayMap.get(unameLower) || '';
      const identityTokens = [unameLower, displayName].filter(Boolean);

      let lastUserMsg = null;
      for (const msg of sorted) {
        if (msg.sender === 'user') {
          lastUserMsg = msg;
        } else if (msg.sender === 'assistant') {
          const review = reviewByMsgId.get(Number(msg.id)) || null;
          const rawQuestion = lastUserMsg ? lastUserMsg.content : '(No preceding user prompt)';
          const rawAnswer = msg.content || '';
          const wasRefusal = Boolean(msg.wasRefusal) || REFUSAL_TEXT_PATTERN.test(rawAnswer);

          entries.push({
            messageId: Number(msg.id),
            anonymousStudentId: anonId,
            group: groupName,
            question: scrubIdentityFromText(rawQuestion, anonId, identityTokens),
            answer: scrubIdentityFromText(rawAnswer, anonId, identityTokens),
            wasRefusal,
            flagStatus: review?.status || null,
            mlComment: review?.comment || '',
            reviewedBy: review?.reviewed_by || null,
            reviewedAt: review?.updated_at || review?.created_at || null,
            createdAt: msg.created_at,
          });
          lastUserMsg = null;
        }
      }
    }

    return entries.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.messageId - a.messageId
    );
  }

  applyFilters(entries, { group, status, period, from, to } = {}) {
    const now = new Date();
    let minMs = null;
    let maxMs = null;

    if (period === 'today') {
      minMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    } else if (period === 'week') {
      minMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    } else if (period === 'month') {
      minMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    }

    if (from) {
      const parsedFrom = new Date(from).getTime();
      if (!Number.isNaN(parsedFrom)) {
        minMs = minMs !== null ? Math.max(minMs, parsedFrom) : parsedFrom;
      }
    }

    if (to) {
      const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(to).trim());
      const parsedTo = new Date(isDateOnly ? `${String(to).trim()}T23:59:59.999Z` : to).getTime();
      if (!Number.isNaN(parsedTo)) {
        maxMs = parsedTo;
      }
    }

    const groupFilter = group && String(group).toLowerCase() !== 'all' ? String(group).trim().toLowerCase() : null;
    const statusFilter = status && String(status).toLowerCase() !== 'all' ? String(status).trim().toLowerCase() : null;

    return entries.filter((entry) => {
      if (groupFilter && entry.group.toLowerCase() !== groupFilter) return false;

      if (statusFilter === 'flagged' && !entry.flagStatus) return false;
      if (statusFilter === 'unflagged' && entry.flagStatus) return false;
      if (statusFilter === 'wrong' && entry.flagStatus !== 'wrong') return false;
      if (statusFilter === 'helpful' && entry.flagStatus !== 'helpful') return false;
      if (statusFilter === 'resolved' && entry.flagStatus !== 'resolved') return false;

      const ts = new Date(entry.createdAt).getTime();
      if (minMs !== null && ts < minMs) return false;
      if (maxMs !== null && ts > maxMs) return false;

      return true;
    });
  }

  computeMetrics(entries) {
    const totalConversations = entries.length;
    const distinctDays = new Set(
      entries
        .map((e) => {
          const d = new Date(e.createdAt);
          return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
        })
        .filter(Boolean)
    );
    const daySpan = Math.max(1, distinctDays.size);
    const conversationsPerDay =
      totalConversations > 0 ? Math.round((totalConversations / daySpan) * 10) / 10 : 0;

    const refusalCount = entries.filter((e) => e.wasRefusal).length;
    const refusalRate =
      totalConversations > 0 ? Math.round((refusalCount / totalConversations) * 1000) / 10 : 0;

    const wrongCount = entries.filter((e) => e.flagStatus === 'wrong').length;
    const helpfulCount = entries.filter((e) => e.flagStatus === 'helpful').length;
    const resolvedCount = entries.filter((e) => e.flagStatus === 'resolved').length;
    const flaggedCount = wrongCount + helpfulCount + resolvedCount;

    return {
      totalConversations,
      conversationsPerDay,
      refusalCount,
      refusalRate,
      flaggedCount,
      wrongCount,
      helpfulCount,
      resolvedCount,
      retentionDays: LOG_RETENTION_DAYS,
    };
  }

  async getLogsDashboard(filters = {}) {
    const [messages, reviews, lookups] = await Promise.all([
      chatRepository.getAllMessages(),
      chatRepository.listReviews(),
      this.buildLookups(),
    ]);

    const allEntries = this.pairConversations(
      messages,
      reviews,
      lookups.userGroupMap,
      lookups.userDisplayMap
    );

    const filteredLogs = this.applyFilters(allEntries, filters);
    const metrics = this.computeMetrics(filteredLogs);

    const priority = { wrong: 0, helpful: 1, resolved: 2 };
    const mlReviewQueue = allEntries
      .filter((e) => e.flagStatus === 'wrong' || e.flagStatus === 'helpful' || e.flagStatus === 'resolved')
      .sort((a, b) => {
        const pa = priority[a.flagStatus] ?? 9;
        const pb = priority[b.flagStatus] ?? 9;
        if (pa !== pb) return pa - pb;
        return new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime();
      });

    return {
      metrics,
      logs: filteredLogs,
      mlReviewQueue,
      availableGroups: lookups.availableGroups,
      anonymizedByDefault: true,
    };
  }

  async flagAnswer(messageId, { status, comment = '' }, adminUsername = 'Administrator') {
    const numericId = Number(messageId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw HttpError.badRequest('Invalid message ID');
    }

    const msg = await chatRepository.getMessageById(numericId);
    if (!msg) {
      throw HttpError.notFound(`Assistant message #${numericId} not found`);
    }
    if (msg.sender !== 'assistant') {
      throw HttpError.badRequest('Only assistant responses can be flagged for review');
    }

    const saved = await chatRepository.upsertReview({
      messageId: numericId,
      status,
      comment,
      reviewedBy: adminUsername,
    });

    return {
      messageId: numericId,
      anonymousStudentId: anonymizeUsername(msg.username),
      flagStatus: saved.status,
      mlComment: saved.comment,
      reviewedBy: saved.reviewed_by,
      reviewedAt: saved.updated_at || saved.created_at,
    };
  }

  async removeFlag(messageId) {
    const numericId = Number(messageId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw HttpError.badRequest('Invalid message ID');
    }
    await chatRepository.deleteReview(numericId);
    return { messageId: numericId, removed: true };
  }

  async purgeExpiredLogs(retentionDays = LOG_RETENTION_DAYS) {
    const days = Math.max(1, Number(retentionDays) || LOG_RETENTION_DAYS);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const result = await chatRepository.purgeMessagesOlderThan(cutoff);
    return {
      retentionDays: days,
      deletedCount: result.deletedCount,
      cutoffDate: result.cutoffDate,
    };
  }
}

export const assistantLogsService = new AssistantLogsService();
