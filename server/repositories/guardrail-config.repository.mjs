import { pool } from '../db.mjs';

export const DEFAULT_GUARDRAIL_CONFIG = {
  version: 1,
  blocked_categories: ['politics', 'medical', 'legal', 'personal'],
  custom_blocked_keywords: [],
  refusal_message_en:
    'I can only assist with academic topics (courses, prerequisites, curriculum roadmap, GPA, and semester planning). Please ask an academic question!',
  refusal_message_ru:
    'Я могу отвечать только на академические вопросы (курсы, пререквизиты, учебный план, расчет GPA и планирование семестра). Пожалуйста, задайте вопрос по вашей учёбе!',
  disclaimer_text: 'Please confirm with your advisor or the deanery.',
  official_deadlines: {
    drop_deadline: 'Friday of Week 2 of the semester (Add/Drop period); withdrawal with W is available until Week 8.',
    registration_deadline: 'Closes at the end of Week 1 after classes begin (regular Add/Drop continues through Week 2).',
    retake_rule: 'Failed courses (F/FX) must be retaken in the next semester when offered.',
  },
  redact_sensitive_data: true,
  updated_by: 'System',
  is_active: true,
};

let activeGuardrailCache = null;
let activeGuardrailCacheExpiry = 0;
const CACHE_TTL_MS = 30000;

function normalizeConfigRow(row) {
  if (!row) return { ...DEFAULT_GUARDRAIL_CONFIG, created_at: new Date().toISOString() };
  return {
    ...DEFAULT_GUARDRAIL_CONFIG,
    ...row,
    blocked_categories: Array.isArray(row.blocked_categories)
      ? row.blocked_categories
      : DEFAULT_GUARDRAIL_CONFIG.blocked_categories,
    custom_blocked_keywords: Array.isArray(row.custom_blocked_keywords)
      ? row.custom_blocked_keywords
      : [],
    official_deadlines: {
      ...DEFAULT_GUARDRAIL_CONFIG.official_deadlines,
      ...(row.official_deadlines && typeof row.official_deadlines === 'object' ? row.official_deadlines : {}),
    },
  };
}

export class GuardrailConfigRepository {
  async getActiveConfig() {
    if (activeGuardrailCache && Date.now() < activeGuardrailCacheExpiry) {
      return activeGuardrailCache;
    }

    try {
      const { rows } = await pool.query(
        `SELECT id, version, blocked_categories, custom_blocked_keywords,
                refusal_message_en, refusal_message_ru, disclaimer_text,
                official_deadlines, redact_sensitive_data, updated_by, created_at, is_active
         FROM ai_guardrail_configs
         WHERE is_active = true
         ORDER BY version DESC
         LIMIT 1`
      );
      if (rows && rows.length > 0) {
        const normalized = normalizeConfigRow(rows[0]);
        activeGuardrailCache = normalized;
        activeGuardrailCacheExpiry = Date.now() + CACHE_TTL_MS;
        return normalized;
      }
    } catch {
      // Fallback to default config
    }

    return { ...DEFAULT_GUARDRAIL_CONFIG, created_at: new Date().toISOString() };
  }

  clearCache() {
    activeGuardrailCache = null;
    activeGuardrailCacheExpiry = 0;
  }

  async createConfig(data, adminUsername = 'Administrator') {
    let nextVer = 1;
    try {
      const { rows: verRows } = await pool.query(
        'SELECT COALESCE(MAX(version), 0) AS max_ver FROM ai_guardrail_configs'
      );
      nextVer = (Number(verRows[0]?.max_ver) || 0) + 1;
    } catch {
      nextVer = 2;
    }

    try {
      await pool.query('UPDATE ai_guardrail_configs SET is_active = false WHERE is_active = true');
      const { rows } = await pool.query(
        `INSERT INTO ai_guardrail_configs (
           version, blocked_categories, custom_blocked_keywords,
           refusal_message_en, refusal_message_ru, disclaimer_text,
           official_deadlines, redact_sensitive_data, updated_by, is_active
         )
         VALUES ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9, true)
         RETURNING *`,
        [
          nextVer,
          JSON.stringify(data.blocked_categories ?? DEFAULT_GUARDRAIL_CONFIG.blocked_categories),
          JSON.stringify(data.custom_blocked_keywords ?? []),
          data.refusal_message_en || DEFAULT_GUARDRAIL_CONFIG.refusal_message_en,
          data.refusal_message_ru || DEFAULT_GUARDRAIL_CONFIG.refusal_message_ru,
          data.disclaimer_text || DEFAULT_GUARDRAIL_CONFIG.disclaimer_text,
          JSON.stringify({
            ...DEFAULT_GUARDRAIL_CONFIG.official_deadlines,
            ...(data.official_deadlines || {}),
          }),
          data.redact_sensitive_data !== false,
          adminUsername,
        ]
      );
      this.clearCache();
      if (rows && rows[0]) {
        const normalized = normalizeConfigRow(rows[0]);
        activeGuardrailCache = normalized;
        activeGuardrailCacheExpiry = Date.now() + CACHE_TTL_MS;
        return normalized;
      }
    } catch {
      this.clearCache();
    }

    return normalizeConfigRow({ ...data, version: nextVer, updated_by: adminUsername });
  }

  async resetToDefault(adminUsername = 'Administrator') {
    return this.createConfig({ ...DEFAULT_GUARDRAIL_CONFIG }, adminUsername);
  }
}

export const guardrailConfigRepository = new GuardrailConfigRepository();
