import { pool } from './db.mjs';

/**
 * Service for managing user schedule variants in PostgreSQL.
 * Allows students to build multiple timetable variants (e.g. "Main", "No Friday", "Morning")
 * and sync them across all devices seamlessly.
 */

export async function getVariants(userId) {
  if (!userId) return [];

  const { rows } = await pool.query(
    `SELECT id, user_id, name, schedule, is_active, created_at, updated_at
     FROM schedule_variants
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId]
  );

  // Если у пользователя ещё нет ни одного варианта — автоматически создаём базовый "Основной"
  if (rows.length === 0) {
    const defaultVariant = await createVariant(userId, 'Основной', [], true);
    return [defaultVariant];
  }

  // Гарантируем, что ровно один вариант помечен как активный
  if (!rows.some((v) => v.is_active)) {
    rows[0].is_active = true;
    await pool.query(
      `UPDATE schedule_variants SET is_active = true WHERE id = $1`,
      [rows[0].id]
    );
  }

  return rows;
}

export async function createVariant(userId, name, schedule = [], isActive = false) {
  if (!userId || !name) throw new Error('userId and name are required');

  // Если это первый вариант или запрошена активность — сбрасываем активность у остальных
  if (isActive) {
    await pool.query(
      `UPDATE schedule_variants SET is_active = false WHERE user_id = $1`,
      [userId]
    );
  }

  const { rows } = await pool.query(
    `INSERT INTO schedule_variants (user_id, name, schedule, is_active, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, NOW(), NOW())
     RETURNING id, user_id, name, schedule, is_active, created_at, updated_at`,
    [userId, name.trim(), JSON.stringify(schedule), isActive]
  );

  return rows[0];
}

export async function updateVariant(userId, variantId, { name, schedule }) {
  if (!userId || !variantId) return null;

  const updates = [];
  const params = [variantId, userId];
  let idx = 3;

  if (name !== undefined) {
    updates.push(`name = $${idx++}`);
    params.push(String(name).trim());
  }
  if (schedule !== undefined) {
    updates.push(`schedule = $${idx++}::jsonb`);
    params.push(JSON.stringify(schedule));
  }

  updates.push(`updated_at = NOW()`);

  if (updates.length === 1) return null; // только updated_at

  const { rows } = await pool.query(
    `UPDATE schedule_variants
     SET ${updates.join(', ')}
     WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, name, schedule, is_active, created_at, updated_at`,
    params
  );

  return rows[0] ?? null;
}

export async function setActiveVariant(userId, variantId) {
  if (!userId || !variantId) return null;

  await pool.query(
    `UPDATE schedule_variants
     SET is_active = (id = $1), updated_at = NOW()
     WHERE user_id = $2`,
    [variantId, userId]
  );

  const { rows } = await pool.query(
    `SELECT id, user_id, name, schedule, is_active, created_at, updated_at
     FROM schedule_variants
     WHERE id = $1 AND user_id = $2`,
    [variantId, userId]
  );

  return rows[0] ?? null;
}

export async function deleteVariant(userId, variantId) {
  if (!userId || !variantId) return false;

  const { rows } = await pool.query(
    `DELETE FROM schedule_variants
     WHERE id = $1 AND user_id = $2
     RETURNING id, is_active`,
    [variantId, userId]
  );

  if (rows.length === 0) return false;

  // Если удалённый вариант был активным — делаем активным первый оставшийся
  if (rows[0].is_active) {
    await pool.query(
      `UPDATE schedule_variants
       SET is_active = true
       WHERE id = (
         SELECT id FROM schedule_variants WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1
       )`,
      [userId]
    );
  }

  return true;
}
