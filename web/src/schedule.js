/** Утилиты сетки расписания: слоты 08:30..21:30 по 50 минут, дни Mo..Sa. */

export const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const SLOT_START_HOUR = 8; // первый слот 08:30
export const SLOT_COUNT = 14; // 08:30 .. 21:30

export const slotStartLabel = (i) => String(SLOT_START_HOUR + i).padStart(2, '0') + ':30';
export const slotEndLabel = (i) => String(SLOT_START_HOUR + i).padStart(2, '0') + ':20';

export function slotIndexOf(time) {
  const h = parseInt(time.split(':')[0], 10);
  return Math.min(Math.max(h - SLOT_START_HOUR, 0), SLOT_COUNT - 1);
}

/** Слоты секции -> позиции ячеек [{day(0..5), row}] */
export function cellsOf(section) {
  return (section?.schedule ?? []).map((s) => ({ day: s.day - 1, row: slotIndexOf(s.time) }));
}

/** Конфликты: чипы в одной ячейке от разных курсов (или две секции одного типа одного курса). */
export function markConflicts(chips) {
  const byCell = new Map();
  for (const c of chips) {
    const key = `${c.day}|${c.row}`;
    (byCell.get(key) ?? byCell.set(key, []).get(key)).push(c);
  }
  for (const group of byCell.values()) {
    // Конфликт — только разные курсы в одном слоте; своя альтернативная секция
    // того же курса (план вместо корзины) конфликтом не считается.
    const conflict = group.some((a) => group.some((b) => b !== a && b.code !== a.code));
    if (conflict) for (const c of group) c.conflict = true;
  }
  return chips;
}
