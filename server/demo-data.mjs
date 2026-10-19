/**
 * Демо-режим (DEMO=1): сервер отдаёт данные из дампов зонда вместо живого портала.
 * Нужен для разработки/показа UI без логина. Чипы корзины взяты с реальных
 * скриншотов пользователя, секции — из дампа MDE 171 (код подменяется на запрошенный).
 */

import fs from 'node:fs';
import path from 'node:path';

// Дампы читаются лениво: модуль импортируется и в проде (где dumps/ нет),
// а файлы нужны только при DEMO=1.
let data = null;
function ensureLoaded() {
  if (data) return data;
  let dumpDir = null;
  if (fs.existsSync('dumps')) {
    const list = fs.readdirSync('dumps').map((d) => path.join('dumps', d)).sort();
    if (list.length) dumpDir = list.pop();
  }

  if (dumpDir && fs.existsSync(path.join(dumpDir, 'parsed-registrations.json'))) {
    data = {
      registrations: JSON.parse(fs.readFileSync(path.join(dumpDir, 'parsed-registrations.json'), 'utf8')),
      curriculum: JSON.parse(fs.readFileSync(path.join(dumpDir, 'parsed-curriculum.json'), 'utf8')),
      mde171: JSON.parse(fs.readFileSync(path.join(dumpDir, 'parsed-sections.json'), 'utf8')),
    };
  } else {
    data = {
      registrations: { term: '2026 - 2027 Fall', isApproved: true, track: { id: 'demo', name: 'Demo Track' }, progTrack: 'TRACK0', approved: [] },
      curriculum: { program: { title: 'Demo Program', year: 2026, name: 'Computer Science', track: 'Main' }, semesters: [] },
      mde171: { course: { code: 'MDE 171', name: 'Demo Course', hours: '2+1+0', ects: 5 }, depCode: 'MDE', progCode: 'IS', theory: [], practice: [], lab: [] },
    };
  }
  return data;
}

// Расписание корзины — с реальных скриншотов пользователя (2026-2027 Fall).
const BASKET_CHIPS = [
  { code: 'INF 451', kind: 'N', section: '01', slots: [{ day: 4, time: '08:30' }] },
  { code: 'INF 376', kind: 'N', section: '03', slots: [{ day: 2, time: '09:30' }, { day: 2, time: '10:30' }] },
  { code: 'MDE 162', kind: 'N', section: '03', slots: [{ day: 2, time: '11:30' }, { day: 2, time: '12:30' }] },
  { code: 'INF 376', kind: 'P', section: '04', slots: [{ day: 4, time: '11:30' }] },
  { code: 'INF 451', kind: 'P', section: '07', slots: [{ day: 1, time: '13:30' }, { day: 1, time: '14:30' }] },
  { code: 'INF 318', kind: 'N', section: '01', slots: [{ day: 2, time: '14:30' }, { day: 2, time: '15:30' }] },
  { code: 'CSS 216', kind: 'N', section: '01', slots: [{ day: 4, time: '14:30' }, { day: 4, time: '15:30' }] },
  { code: 'MDE 162', kind: 'P', section: '07', slots: [{ day: 1, time: '15:30' }] },
  { code: 'INF 318', kind: 'P', section: '03', slots: [{ day: 2, time: '16:30' }] },
  { code: 'CSS 216', kind: 'P', section: '03', slots: [{ day: 5, time: '16:30' }] },
  { code: 'CSS 280', kind: 'P', section: '02', slots: [{ day: 1, time: '18:30' }] },
];

const demoUser = {
  name: 'Manas Yessendikov',
  program: 'Information Systems (EN) / 2024',
  granted: 240,
  used: 155,
  left: 85,
};

const relabel = (list, code) =>
  list.map((s) => ({ ...s, courseCode: code }));

export const demo = {
  me() {
    const { registrations } = ensureLoaded();
    return {
      demo: true,
      user: demoUser,
      authenticated: true,
      term: registrations.term,
      isApproved: registrations.isApproved,
      track: registrations.track,
      progTrack: registrations.progTrack,
      approved: registrations.approved,
      schedule: BASKET_CHIPS,
    };
  },

  curriculum() {
    return ensureLoaded().curriculum;
  },

  sections(code) {
    const mde171 = ensureLoaded().mde171;
    const requested = (code || 'MDE 171').toUpperCase();
    return {
      demo: true,
      course: { ...mde171.course, code: requested },
      depCode: mde171.depCode,
      progCode: mde171.progCode,
      theory: relabel(mde171.theory, requested),
      practice: relabel(mde171.practice, requested),
      lab: [],
    };
  },
};
