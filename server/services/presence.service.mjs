import { presenceRepository } from '../repositories/presence.repository.mjs';
import { groupRepository } from '../repositories/group.repository.mjs';
import { HttpError } from '../errors/http-error.mjs';

export const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
export const AWAY_THRESHOLD_MS = 5 * 60 * 1000;   // 5 minutes

export function formatSeenTime(dateInput, timeZone = process.env.APP_TIMEZONE || 'Asia/Almaty') {
  if (!dateInput) return null;
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    const minute = parts.find((p) => p.type === 'minute')?.value;
    if (hour && minute) return `${hour}:${minute}`;
  } catch {
    // Fallback to process local time if timezone string is invalid
  }

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export class PresenceService {
  computePresencePayload(presenceRow, userRow, nowMs = Date.now()) {
    const officeHours = String(presenceRow?.office_hours || '').trim();
    const responseTimeNote = String(presenceRow?.response_time_note || '').trim();

    // Blocked or missing accounts must never appear Online or Away (US30 guardrail)
    if (!userRow || Boolean(userRow.is_blocked)) {
      return {
        status: 'offline',
        isOnline: false,
        statusText: 'Offline',
        lastSeenAt: null,
        officeHours,
        responseTimeNote,
      };
    }

    if (!presenceRow || !presenceRow.last_seen_at) {
      return {
        status: 'offline',
        isOnline: false,
        statusText: 'Offline',
        lastSeenAt: null,
        officeHours,
        responseTimeNote,
      };
    }

    const seenDate = new Date(presenceRow.last_seen_at);
    if (Number.isNaN(seenDate.getTime())) {
      return {
        status: 'offline',
        isOnline: false,
        statusText: 'Offline',
        lastSeenAt: null,
        officeHours,
        responseTimeNote,
      };
    }

    const diffMs = Math.max(0, nowMs - seenDate.getTime());
    const seenIso = seenDate.toISOString();
    const hhmm = formatSeenTime(seenDate);

    if (!presenceRow.is_online || diffMs > AWAY_THRESHOLD_MS) {
      return {
        status: 'offline',
        isOnline: false,
        statusText: hhmm ? `Offline, was seen at ${hhmm}` : 'Offline',
        lastSeenAt: seenIso,
        officeHours,
        responseTimeNote,
      };
    }

    if (diffMs <= ONLINE_THRESHOLD_MS) {
      return {
        status: 'online',
        isOnline: true,
        statusText: 'Online',
        lastSeenAt: seenIso,
        officeHours,
        responseTimeNote,
      };
    }

    return {
      status: 'away',
      isOnline: false,
      statusText: 'Away',
      lastSeenAt: seenIso,
      officeHours,
      responseTimeNote,
    };
  }

  async touchUserPresence(username, isOnline = true, customLastSeenAt = null) {
    if (!username) return null;
    return presenceRepository.touchPresence(username, isOnline, customLastSeenAt);
  }

  async markUserOffline(username, customLastSeenAt = null) {
    if (!username) return null;
    return presenceRepository.setOffline(username, customLastSeenAt);
  }

  async getPresenceForUsername(username, nowMs = Date.now()) {
    if (!username) {
      return this.computePresencePayload(null, null, nowMs);
    }
    const { user, presence } = await presenceRepository.getPresenceWithUser(username);
    return this.computePresencePayload(presence, user, nowMs);
  }

  async getMyPresence(username, nowMs = Date.now()) {
    if (!username) {
      throw HttpError.unauthorized('not authenticated');
    }
    const payload = await this.getPresenceForUsername(username, nowMs);
    return {
      username: String(username).trim(),
      ...payload,
    };
  }

  async getAdvisorPresenceForStudent(studentUsername, targetAdvisorUsername = null, nowMs = Date.now()) {
    if (!studentUsername) {
      throw HttpError.unauthorized('not authenticated');
    }

    const membership = await groupRepository.getStudentGroupAndAdvisor(studentUsername);
    const requestedAdvisor = targetAdvisorUsername ? String(targetAdvisorUsername).trim() : null;

    // Privacy check (US30 + US26): students cannot inspect presence of another group's advisor
    if (requestedAdvisor) {
      const assignedAdvisor = membership?.advisor_username || '';
      if (!assignedAdvisor || assignedAdvisor.toLowerCase() !== requestedAdvisor.toLowerCase()) {
        throw HttpError.forbidden('You can only message your own group advisor');
      }
    }

    if (!membership) {
      return {
        assigned: false,
        group: null,
        advisor: null,
        presence: null,
      };
    }

    const group = {
      id: membership.group_id,
      name: membership.group_name,
      program: membership.program,
      study_year: membership.study_year,
    };

    if (!membership.advisor_username) {
      return {
        assigned: false,
        group,
        advisor: null,
        presence: null,
      };
    }

    const presence = await this.getPresenceForUsername(membership.advisor_username, nowMs);

    return {
      assigned: true,
      group,
      advisor: {
        username: membership.advisor_username,
        display_name: membership.advisor_display_name,
        avatar_url: membership.advisor_avatar_url,
        role: membership.advisor_role || 'Advisor',
      },
      presence,
    };
  }

  async updateMyOfficeHours(username, role, { office_hours = '', response_time_note = '' } = {}) {
    if (!username) {
      throw HttpError.unauthorized('not authenticated');
    }
    if (role !== 'Advisor' && role !== 'Administrator') {
      throw HttpError.forbidden('Only advisors can configure office hours');
    }

    await presenceRepository.updateOfficeHours(username, {
      office_hours: String(office_hours || '').trim(),
      response_time_note: String(response_time_note || '').trim(),
    });

    return this.getMyPresence(username);
  }
}

export const presenceService = new PresenceService();
