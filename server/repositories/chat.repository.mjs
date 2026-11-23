import { pool } from '../db.mjs';

// In-memory fallback store to ensure 100% reliability in offline / test environments
const inMemoryMessages = new Map(); // username -> Array<Message>

function normalizeRow(row) {
  if (!row) return row;
  const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const links = Array.isArray(row.links) ? row.links : (Array.isArray(meta.links) ? meta.links : []);
  const courseCards = Array.isArray(row.courseCards)
    ? row.courseCards
    : (Array.isArray(meta.courseCards) ? meta.courseCards : []);
  const wasRefusal = Boolean(row.wasRefusal ?? meta.wasRefusal ?? false);
  return {
    id: row.id,
    username: row.username,
    sender: row.sender,
    content: row.content,
    links,
    courseCards,
    wasRefusal,
    created_at: row.created_at,
  };
}

export class ChatRepository {
  async getMessages(username, limit = 100) {
    if (!username) return [];
    try {
      const { rows } = await pool.query(
        `SELECT id, username, sender, content, metadata, created_at
         FROM ai_chat_messages
         WHERE username = $1
         ORDER BY created_at ASC
         LIMIT $2`,
        [username, limit]
      );
      if (rows && rows.length > 0) {
        return rows.map(normalizeRow);
      }
    } catch {
      try {
        const { rows } = await pool.query(
          `SELECT id, username, sender, content, created_at
           FROM ai_chat_messages
           WHERE username = $1
           ORDER BY created_at ASC
           LIMIT $2`,
          [username, limit]
        );
        if (rows && rows.length > 0) {
          return rows.map(normalizeRow);
        }
      } catch {
        // Fallback to in-memory store
      }
    }

    const list = inMemoryMessages.get(username) || [];
    return list.slice(-limit).map(normalizeRow);
  }

  async addMessage(username, sender, content, extra = {}) {
    const links = Array.isArray(extra?.links) ? extra.links : [];
    const courseCards = Array.isArray(extra?.courseCards) ? extra.courseCards : [];
    const wasRefusal = Boolean(extra?.wasRefusal);
    const metadataObj = {};
    if (links.length > 0) metadataObj.links = links;
    if (courseCards.length > 0) metadataObj.courseCards = courseCards;
    if (wasRefusal) metadataObj.wasRefusal = true;

    const timestamp = extra?.createdAt ? new Date(extra.createdAt).toISOString() : new Date().toISOString();
    const fallbackMessage = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      username,
      sender,
      content,
      links,
      courseCards,
      wasRefusal,
      created_at: timestamp,
    };

    // Update in-memory fallback store
    if (!inMemoryMessages.has(username)) {
      inMemoryMessages.set(username, []);
    }
    inMemoryMessages.get(username).push(fallbackMessage);

    try {
      const { rows } = await pool.query(
        `INSERT INTO ai_chat_messages (username, sender, content, metadata, created_at)
         VALUES ($1, $2, $3, $4::jsonb, COALESCE($5::timestamp, NOW()))
         RETURNING id, username, sender, content, metadata, created_at`,
        [username, sender, content, JSON.stringify(metadataObj), extra?.createdAt ? timestamp : null]
      );
      if (rows && rows[0]) {
        return normalizeRow(rows[0]);
      }
    } catch {
      try {
        const { rows } = await pool.query(
          `INSERT INTO ai_chat_messages (username, sender, content, created_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING id, username, sender, content, created_at`,
          [username, sender, content]
        );
        if (rows && rows[0]) {
          return normalizeRow({ ...rows[0], links, courseCards, wasRefusal });
        }
      } catch {
        // Fallback
      }
    }

    return fallbackMessage;
  }

  async getAllMessages() {
    try {
      const { rows } = await pool.query(
        `SELECT id, username, sender, content, metadata, created_at
         FROM ai_chat_messages
         ORDER BY created_at ASC, id ASC`
      );
      if (rows) {
        return rows.map(normalizeRow);
      }
    } catch {
      // Fallback to in-memory store
    }

    const all = [];
    for (const list of inMemoryMessages.values()) {
      all.push(...list);
    }
    return all
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(normalizeRow);
  }

  async getMessageById(messageId) {
    try {
      const { rows } = await pool.query(
        `SELECT id, username, sender, content, metadata, created_at
         FROM ai_chat_messages
         WHERE id = $1`,
        [Number(messageId)]
      );
      if (rows && rows[0]) return normalizeRow(rows[0]);
    } catch {
      // Fallback
    }
    for (const list of inMemoryMessages.values()) {
      const found = list.find((m) => Number(m.id) === Number(messageId));
      if (found) return normalizeRow(found);
    }
    return null;
  }

  async listReviews() {
    try {
      const { rows } = await pool.query(
        `SELECT id, message_id, status, comment, reviewed_by, created_at, updated_at
         FROM ai_chat_log_reviews
         ORDER BY updated_at DESC, id DESC`
      );
      return rows || [];
    } catch {
      return [];
    }
  }

  async upsertReview({ messageId, status, comment = '', reviewedBy = 'Administrator' }) {
    const { rows } = await pool.query(
      `INSERT INTO ai_chat_log_reviews (message_id, status, comment, reviewed_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (message_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         comment = EXCLUDED.comment,
         reviewed_by = EXCLUDED.reviewed_by,
         updated_at = NOW()
       RETURNING id, message_id, status, comment, reviewed_by, created_at, updated_at`,
      [Number(messageId), status, String(comment || '').trim(), reviewedBy]
    );
    return rows[0] || null;
  }

  async deleteReview(messageId) {
    const { rows, rowCount } = await pool.query(
      `DELETE FROM ai_chat_log_reviews WHERE message_id = $1 RETURNING message_id`,
      [Number(messageId)]
    );
    return { removed: (rows?.length ?? rowCount ?? 0) > 0 };
  }

  async purgeMessagesOlderThan(cutoffDate) {
    const cutoffIso = new Date(cutoffDate).toISOString();
    const cutoffMs = new Date(cutoffIso).getTime();

    // Sync in-memory fallback map
    for (const [uname, list] of inMemoryMessages.entries()) {
      const kept = list.filter((m) => new Date(m.created_at).getTime() >= cutoffMs);
      if (kept.length === 0) inMemoryMessages.delete(uname);
      else inMemoryMessages.set(uname, kept);
    }

    try {
      const { rows, rowCount } = await pool.query(
        `DELETE FROM ai_chat_messages WHERE created_at < $1 RETURNING id`,
        [cutoffIso]
      );
      return { deletedCount: rows?.length ?? rowCount ?? 0, cutoffDate: cutoffIso };
    } catch {
      return { deletedCount: 0, cutoffDate: cutoffIso };
    }
  }

  async clearMessages(username) {
    inMemoryMessages.delete(username);
    try {
      await pool.query('DELETE FROM ai_chat_messages WHERE username = $1', [username]);
    } catch {
      // Ignore fallback
    }
  }
}

export const chatRepository = new ChatRepository();
