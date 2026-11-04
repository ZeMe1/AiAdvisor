import { pool } from '../db.mjs';

export const DEFAULT_RECOMMENDATION_CONFIG = {
  version: 1,
  min_ects: 20,
  max_ects: 21,
  gpa_weight: 1.0,
  retake_weight: 2.0,
  interest_weight: 1.5,
  disabled_programs: [],
  created_by: 'System',
  is_active: true,
};

// In-memory cache for fast active config retrieval
let activeConfigCache = null;
let activeConfigCacheExpiry = 0;
const ACTIVE_CONFIG_TTL_MS = 30000; // 30s

export class RecommendationConfigRepository {
  async getActiveConfig() {
    if (activeConfigCache && Date.now() < activeConfigCacheExpiry) {
      return activeConfigCache;
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, version, min_ects, max_ects, 
                gpa_weight::float AS gpa_weight, 
                retake_weight::float AS retake_weight, 
                interest_weight::float AS interest_weight, 
                disabled_programs, created_by, created_at, is_active
         FROM recommendation_configs
         WHERE is_active = true
         ORDER BY version DESC
         LIMIT 1`
      );

      if (rows.length > 0) {
        activeConfigCache = rows[0];
        activeConfigCacheExpiry = Date.now() + ACTIVE_CONFIG_TTL_MS;
        this.clearCache();
    return rows[0];
      }
    } catch (err) {
      console.warn('[recommendationConfigRepository] DB query failed, using fallback default:', err.message);
    }

    return { ...DEFAULT_RECOMMENDATION_CONFIG, created_at: new Date().toISOString() };
  }

  clearCache() {
    activeConfigCache = null;
    activeConfigCacheExpiry = 0;
  }

  async createConfig({
    min_ects,
    max_ects,
    gpa_weight = 1.0,
    retake_weight = 2.0,
    interest_weight = 1.5,
    disabled_programs = [],
    created_by = 'Administrator',
  }) {
    // 1. Get latest version
    const { rows: verRows } = await pool.query(
      `SELECT COALESCE(MAX(version), 0) AS max_ver FROM recommendation_configs`
    );
    const nextVersion = (verRows[0]?.max_ver || 0) + 1;

    // 2. Deactivate existing active configs
    await pool.query(`UPDATE recommendation_configs SET is_active = false WHERE is_active = true`);

    // 3. Insert new version
    const { rows } = await pool.query(
      `INSERT INTO recommendation_configs (
         version, min_ects, max_ects, gpa_weight, retake_weight, interest_weight, disabled_programs, created_by, is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, true)
       RETURNING id, version, min_ects, max_ects, 
                 gpa_weight::float AS gpa_weight, 
                 retake_weight::float AS retake_weight, 
                 interest_weight::float AS interest_weight, 
                 disabled_programs, created_by, created_at, is_active`,
      [
        nextVersion,
        Number(min_ects),
        Number(max_ects),
        Number(gpa_weight),
        Number(retake_weight),
        Number(interest_weight),
        JSON.stringify(disabled_programs || []),
        created_by || 'Administrator',
      ]
    );

    this.clearCache();
    return rows[0];
  }

  async getConfigHistory(limit = 20) {
    const { rows } = await pool.query(
      `SELECT id, version, min_ects, max_ects, 
              gpa_weight::float AS gpa_weight, 
              retake_weight::float AS retake_weight, 
              interest_weight::float AS interest_weight, 
              disabled_programs, created_by, created_at, is_active
       FROM recommendation_configs
       ORDER BY version DESC
       LIMIT $1`,
      [limit]
    );
    return rows;
  }

  async resetToDefault(createdBy = 'Administrator') {
    return this.createConfig({
      min_ects: DEFAULT_RECOMMENDATION_CONFIG.min_ects,
      max_ects: DEFAULT_RECOMMENDATION_CONFIG.max_ects,
      gpa_weight: DEFAULT_RECOMMENDATION_CONFIG.gpa_weight,
      retake_weight: DEFAULT_RECOMMENDATION_CONFIG.retake_weight,
      interest_weight: DEFAULT_RECOMMENDATION_CONFIG.interest_weight,
      disabled_programs: [],
      created_by: createdBy,
    });
  }
}

export const recommendationConfigRepository = new RecommendationConfigRepository();
