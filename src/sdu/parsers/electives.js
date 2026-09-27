/**
 * Парсер списка элективных курсов — ответ
 *   POST index.php  ajx=1&mod=course_reg&action=ShowElectiveCoursesByElCode&...
 *
 * Формат ответа тот же конверт {CODE, DATA}. Внутри DATA — HTML-таблица курсов
 * группы; у каждого курса кнопка с onclick ShowAvailableAllSections(...) или
 * ShowSectionsByDersKod(...). Точная структура не дампилась, поэтому парсер
 * защитный: если ничего не разобралось — используем candidateCodes из
 * group_title заглушки (они гарантированно есть из куррикулума).
 */

import * as cheerio from 'cheerio';
import { parseOnclickArgs } from './curriculum.js';

function parseElectivesHtml(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const link = $tr.find('a[onclick]').toArray()
      .map((a) => parseOnclickArgs($(a).attr('onclick')))
      .find((r) => r && (r.fn === 'sections' || r.fn === 'derskod'));
    if (!link) return;
    const a = link.args;
    const code = String(a.dersKod ?? a.dk ?? '').trim();
    if (!code || out.some((c) => c.code === code)) return;

    // ячейка с кодом -> следующая обычно название; кредиты/ects — числовые ячейки
    const tds = $tr.find('td').toArray().map((td) => $(td).text().replace(/\s+/g, ' ').trim());
    const codeIdx = tds.findIndex((t) => t.includes(code));
    const name = codeIdx >= 0 && tds[codeIdx + 1] ? tds[codeIdx + 1] : '';
    const numbers = tds.filter((t) => /^\d{1,2}$/.test(t)).map(Number);

    out.push({
      code,
      name,
      credits: numbers.at(-2) ?? null,
      ects: numbers.at(-1) ?? null,
      sectionsParams: {
        dk: code,
        pc: a.progCode ?? null,
        py: a.progYear ?? null,
        track: a.progTrack ?? null,
        mufSqId: a.muf_sq_id ?? null, // портал добавляет его при запросе секций из электива
      },
    });
  });
  return out;
}

export function parseElectivesResponse(json, fallbackCodes = []) {
  const courses = String(json?.CODE) === '1' && typeof json.DATA === 'string'
    ? parseElectivesHtml(json.DATA)
    : [];
  return {
    fromPortal: courses.length > 0,
    courses: courses.length > 0 ? courses : fallbackCodes.map((code) => ({ code, name: '' })),
  };
}
