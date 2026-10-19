/**
 * Парсер страницы GET index.php?mod=course_reg — текущие регистрации.
 *
 * Страница содержит:
 *   div.modTitle           — "(2026 - 2027 Fall)" + select#selectTrack (id трека) + hidden#progTrack
 *   div.modContent         — таблица утверждённых регистраций table.clsTbl, колонки:
 *     0 №, 1 код, 2 N-секция (title = преподаватель), 3 P-секция (title = преподаватель),
 *     4 L-секция, 5 название, 6 cr (title = "2+1+0"), 7 ects, 8 STATUS, 9 price
 */

import * as cheerio from 'cheerio';

export function parseCourseRegPage(html) {
  if (!html || typeof html !== 'string' || html.trim().length === 0) {
    return { authenticated: false };
  }
  if (/name="password"|loginAuth\.php|verification\.php|<title>\s*Login/i.test(html)) {
    return { authenticated: false };
  }

  const $ = cheerio.load(html);

  const hasModTitle = $('.modTitle').length > 0;
  const hasTrack = $('#selectTrack').length > 0;
  const hasTable = $('table.clsTbl').length > 0;
  if (!hasModTitle && !hasTrack && !hasTable) {
    return { authenticated: false };
  }

  let term = null;
  for (const el of $('.modTitle')) {
    const m = $(el).text().match(/\((\d{4}\s*-\s*\d{4}\s+(?:Fall|Spring|Summer))\)/i);
    if (m) { term = m[1].replace(/\s+/g, ' '); break; }
  }

  const trackOpt = $('#selectTrack option').first();
  const track = trackOpt.length
    ? { id: trackOpt.attr('value') ?? null, name: trackOpt.text().replace(/\s+/g, ' ').trim() }
    : null;
  const progTrack = $('#progTrack').attr('value') ?? null;

  const approved = [];
  const CODE_RE = /^[A-Z]{2,4} ?\d{3}[A-Z]?$/i;
  $('.modContent table.clsTbl').first().find('tr').each((_, tr) => {
    const td = $(tr).find('td');
    if (td.length < 10) return;
    const code = td.eq(1).text().trim();
    if (!CODE_RE.test(code)) return; // шапка, итоги и прочий мусор
    approved.push({
      code: td.eq(1).text().trim(),
      normalSection: td.eq(2).text().trim() || null,
      normalTeacher: td.eq(2).attr('title') || null,
      practiceSection: td.eq(3).text().trim() || null,
      practiceTeacher: td.eq(3).attr('title') || null,
      labSection: td.eq(4).text().trim() || null,
      name: td.eq(5).text().replace(/\s+/g, ' ').trim(),
      credits: td.eq(6).text().trim(),
      hours: td.eq(6).attr('title') || null,
      ects: td.eq(7).text().trim(),
      status: td.eq(8).text().replace(/\s+/g, ' ').trim(),
      price: td.eq(9).text().trim() || null,
    });
  });

  return {
    authenticated: true,
    term,
    isApproved: /registration is APPROVED/i.test($('div.modContent').first().text()),
    track,
    progTrack,
    approved,
  };
}
