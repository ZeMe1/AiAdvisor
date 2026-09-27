/**
 * Парсер секций — ответ
 *   POST index.php  ajx=1&mod=course_reg&action=ShowAvailableAllSections&dk=<code>&pc=<progCode>&py=<year>&track=<track>
 *   -> { CODE, DATA, DATA2, DATA3 }
 *
 * Главное (проверено на дампах):
 *   DATA  — HTML-таблицы для UI портала (нам не нужны, имя курса берём отсюда)
 *   DATA2 — [ { <sectionId>: {...} }, { <sectionId>: {...} }, ... ]
 *           [0] = theory (TYPE "N"), [1] = practice (TYPE "P"), [2] = labs (пока пусто)
 *   DATA3 — { DEP_CODE, PROG_CODE }
 */

import { parseSchedule, splitIds, num } from './normalize.js';
import * as cheerio from 'cheerio';

function normalizeSection(id, s, kind) {
  const quota = num(s.QUOTA);
  const enrolled = num(s.STUD_COUNT);
  const reserved = num(s.RESERVED_QUOTA);
  const seatsLeft = quota - enrolled - reserved;
  return {
    id: String(s.DERS_SOBE_ID ?? id),
    courseCode: s.DERS_KOD,
    year: num(s.YEAR),
    term: num(s.TERM),
    kind, // "N" theory | "P" practice | "L" lab
    section: s.SECTION,
    message: s.MESSAGE || '',
    teacher: s.TEACHER || '',
    empId: s.EMP_ID ?? null,
    credits: { teor: num(s.K_TEOR), practice: num(s.K_PRAT), lab: num(s.K_LAB), total: num(s.K_QU) },
    quota,
    enrolled,
    reserved,
    seatsLeft,
    isAvailable: seatsLeft > 0,
    isScheduled: String(s.SCHEDULED) === '1',
    schedule: parseSchedule(s.SCHEDULE),
    practiceIds: splitIds(s.PRACTICE),
    labIds: splitIds(s.LAB),
    status: s.STATUS ?? null,
    paid: s.PAID_SECTION != null,
  };
}

function entriesOf(x) {
  if (!x) return [];
  return Array.isArray(x) ? [] : Object.entries(x);
}

/** Из HTML-шапки DATA: "MDE 171 - History of Kazakhstan  [ 2 + 1 + 0 ]  / 5 ects" */
export function parseCourseInfoHtml(html) {
  const $ = cheerio.load(html);
  const raw = $('div.desc b').first().text().replace(/\s+/g, ' ').trim();
  const m = raw.match(/^([\w-]+ ?[\w-]*)\s*-\s*(.+?)\s*\[\s*([\d\s+]+?)\s*\]\s*\/\s*(\d+)\s*ects/i);
  if (!m) return { raw };
  return { raw, code: m[1], name: m[2], hours: m[3], ects: Number(m[4]) };
}

export function parseSectionsResponse(json) {
  const [norm = {}, pract = {}, lab = []] = Array.isArray(json.DATA2) ? json.DATA2 : [];
  return {
    course: parseCourseInfoHtml(json.DATA || ''),
    depCode: json.DATA3?.DEP_CODE ?? null,
    progCode: json.DATA3?.PROG_CODE ?? null,
    theory: entriesOf(norm).map(([id, s]) => normalizeSection(id, s, 'N')),
    practice: entriesOf(pract).map(([id, s]) => normalizeSection(id, s, 'P')),
    lab: entriesOf(lab).map(([id, s]) => normalizeSection(id, s, 'L')),
  };
}
