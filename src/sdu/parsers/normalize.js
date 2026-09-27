/** Общие нормализующие функции для парсеров SDU. */

/** "2.19:30,2.20:30" -> [{ day: 2, time: "19:30" }, { day: 2, time: "20:30" }].
 *  День: 1 = понедельник ... 7 = воскресенье (соглашение портала, проверить на живых данных). */
export function parseSchedule(str) {
  if (typeof str !== 'string' || !str.trim()) return [];
  const out = [];
  for (const part of str.split(',')) {
    const m = part.trim().match(/^(\d{1})\.(\d{1,2}):(\d{2})$/);
    if (m) out.push({ day: Number(m[1]), time: `${m[2].padStart(2, '0')}:${m[3]}` });
  }
  return out;
}

export const splitIds = (v) =>
  (typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
