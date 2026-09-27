/**
 * Парсер куррикулума — HTML из ответа
 *   POST index.php  ajx=1&mod=course_reg&action=ShowSearchTypesChanged&mtype=by_prog&id=<trackId>
 *   -> { CODE, DATA }  (DATA = HTML)
 *
 * Структура DATA (проверено на дампах):
 *   div.subTitle          — "2024-Information Systems (EN) <br> Main Track"
 *   table#tblMufredatProg — контейнер семестров
 *     table.relParent     — один семестр; tr.absNum .num = номер семестра
 *       table.clsTbl      — строки курсов, 12 колонок:
 *         0 №, 1 код (может быть заглушка "XXX 10X"), 2 название, 3 прочее,
 *         4 teor, 5 practice ("0+2"), 6 cr, 7 ects, 8 grade, 9 requisites,
 *         10 кнопка Choose (onclick с параметрами), 11 syllabus
 *   Цвет строки = статус: #009900 passed, #FF9900 taken, #FF0000 failed, #0000CC not taken
 */

import * as cheerio from 'cheerio';

const STATUS_BY_COLOR = {
  '#009900': 'passed',
  '#ff9900': 'taken',
  '#ff0000': 'failed',
  '#0000cc': 'not_taken',
};

/** Разбор аргументов onclick вида Fn({ a:'x', b:123, c:"y" }). */
export function parseOnclickArgs(onclick) {
  if (!onclick) return null;
  const fn = onclick.includes('ShowElectiveCoursesByElCode')
    ? 'elective'
    : onclick.includes('ShowAvailableAllSections')
      ? 'sections'
      : onclick.includes('ShowSectionsByDersKod')
        ? 'derskod'
        : null;
  if (!fn) return null;
  const body = onclick.match(/\{([\s\S]*)\}\s*\)/)?.[1] ?? '';
  const args = {};
  const re = /(\w+)\s*:\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?))/g;
  let m;
  while ((m = re.exec(body))) args[m[1]] = m[2] ?? m[3] ?? Number(m[4]);
  return { fn, args };
}

function rowStatus($tr) {
  const style = $tr.attr('style') || '';
  const color = style.match(/#[0-9a-f]{6}/i)?.[0]?.toLowerCase();
  return STATUS_BY_COLOR[color] ?? 'unknown';
}

/** group_title: "Turkish language 1 (MDE 283, MDE 285)" -> { name, candidates: ["MDE 283","MDE 285"] } */
export function parseGroupTitle(title = '') {
  const m = title.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { name: title.trim(), candidates: [] };
  return {
    name: m[1].trim(),
    candidates: m[2].split(',').map((s) => s.trim()).filter(Boolean),
  };
}

function parseCourseRow($tr) {
  const td = $tr.find('td');
  if (td.length < 11) return null; // строка-заголовок или мусор
  if (td.eq(0).text().trim() === '№') return null;

  const codeCell = td.eq(1);
  const code = codeCell.contents().first().text().trim();
  const lastTaken = codeCell.find('font[title]').first().text().trim() || null;
  const action = parseOnclickArgs(td.eq(10).find('a[onclick]').first().attr('onclick'));
  const syllabus = td.eq(11).find('a[href]').first().attr('href') || null;

  const course = {
    code,
    name: td.eq(2).text().replace(/\s+/g, ' ').trim(),
    isElective: /^XXX/i.test(code),
    hours: { teor: td.eq(4).text().trim(), practice: td.eq(5).text().trim() },
    credits: td.eq(6).text().trim(),
    ects: td.eq(7).text().trim(),
    grade: td.eq(8).text().replace(/[\s\u00a0]+/g, ' ').trim() || null,
    requisites: td.eq(9).text().replace(/\s+/g, ' ').trim() || null,
    status: rowStatus($tr),
    syllabusUrl: syllabus,
    lastTaken,
  };

  if (course.isElective && action?.fn === 'elective') {
    const a = action.args;
    const group = parseGroupTitle(String(a.group_title ?? ''));
    course.elective = {
      mufSqId: a.muf_sq_id ?? null,
      periodNo: a.period_no ?? null,
      codeType: a.codeType ?? null,
      lgCode: a.lgCode ?? null,
      type: a.type ?? null,
      groupName: group.name,
      candidateCodes: group.candidates,
    };
    course.name = group.name || course.name;
  }

  if (action?.fn === 'sections') {
    course.sectionsParams = {
      dk: action.args.dersKod ?? course.code,
      pc: action.args.progCode ?? null,
      py: action.args.progYear ?? null,
      track: action.args.progTrack ?? null,
      sentFrom: action.args.sentFrom ?? null,
    };
  }

  return course;
}

export function parseCurriculumHtml(html) {
  const $ = cheerio.load(html);

  const subHtml = $('.subTitle').first().html() || '';
  const [progPart = '', trackPart = ''] = subHtml.split(/<br\s*\/?>/i);
  const progTitle = cheerio.load(progPart).root().text().replace(/\s+/g, ' ').trim();
  const pm = progTitle.match(/^(\d{4})-(.*)$/);
  const trackName = cheerio.load(trackPart).root().text().replace(/\s+/g, ' ').trim();

  const semesters = [];
  $('table.relParent').each((_, rel) => {
    const $rel = $(rel);
    const no = parseInt($rel.find('tr.absNum .num').first().text().trim(), 10) || semesters.length + 1;
    const courses = [];
    $rel.find('table.clsTbl').first().find('tr').each((_, tr) => {
      const course = parseCourseRow($(tr));
      if (course) courses.push(course);
    });
    semesters.push({ no, courses });
  });

  return {
    program: {
      title: progTitle,
      year: pm ? Number(pm[1]) : null,
      name: pm ? pm[2] : progTitle,
      track: trackName || null,
    },
    semesters,
  };
}
