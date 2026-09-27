#!/usr/bin/env node
/**
 * Зонд портала my.sdu.edu.kz (SDU Student Information System).
 *
 * Что делает:
 *   1) GET /                          — получает PHPSESSID и форму логина
 *   2) POST /loginAuth.php            — логин; по редиректу определяет, нужна ли 2FA
 *   3) GET+POST /verification.php     — (если потребовалась) ввод 6-значного кода из письма
 *   4) GET /                          — проверка, что сессия живая
 *   5) GET /index.php?mod=course_reg  — главный дамп для будущих парсеров
 *   6) Автопоиск ajx-эндпоинтов и параметров в HTML + проверка известных payload'ов
 *
 * Запуск:
 *   npm run probe
 *   (или: node tools/probe-sdu.mjs; можно неинтерактивно: SDU_USER=... SDU_PASS=... node tools/probe-sdu.mjs)
 *
 * Пароль вводится скрыто, не печатается и нигде не сохраняется.
 * Сырые ответы складываются в dumps/<timestamp>/ — НЕ публикуй их:
 * там PHPSESSID и твои персональные данные.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline/promises';
import { Writable } from 'node:stream';

const BASE = 'https://my.sdu.edu.kz';

// ------------------------------------------------------------------ вывод/дампы
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const outDir = path.resolve('dumps', stamp);
fs.mkdirSync(outDir, { recursive: true });

const logFile = path.join(outDir, 'run.log');
function log(msg = '') {
  console.log(msg);
  fs.appendFileSync(logFile, msg + '\n');
}

const summary = { startedAt: new Date().toISOString(), base: BASE, steps: [], discovered: null, ajax: [] };
const step = (name, data) => summary.steps.push({ name, ...data });

// ------------------------------------------------------------------ cookie jar
const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

function absorbCookies(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

// ------------------------------------------------------------------ http
async function req(method, urlOrPath, { form, referer, xhr } = {}) {
  const url = urlOrPath.startsWith('http') ? urlOrPath : BASE + urlOrPath;
  const headers = {
    'User-Agent': 'ZeMe-probe/0.1 (student schedule planner research)',
    Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  };
  if (jar.size) headers.Cookie = cookieHeader();
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (referer) headers.Referer = referer;
  if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';

  const res = await fetch(url, {
    method,
    headers,
    body: form ? new URLSearchParams(form).toString() : undefined,
    redirect: 'manual',
  });
  absorbCookies(res);
  const text = await res.text();
  return {
    status: res.status,
    location: res.headers.get('location'),
    contentType: res.headers.get('content-type') || '',
    text,
  };
}

function dump(name, r) {
  fs.writeFileSync(path.join(outDir, name), r.text);
}

const isLoginPage = (html) => /name="password"/.test(html);

function describeBody(r) {
  try {
    const j = JSON.parse(r.text);
    return `JSON keys=[${Object.keys(j).join(',')}] CODE=${j.CODE} DATA.length=${(j.DATA || '').length}`;
  } catch {
    const head = r.text.slice(0, 140).replace(/\s+/g, ' ').trim();
    return `not JSON (${r.contentType || 'no content-type'}); starts: ${head}`;
  }
}

// ------------------------------------------------------------------ html helpers
function inputsOf(html) {
  const out = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = (a) => (tag.match(new RegExp(`${a}\\s*=\\s*"([^"]*)"`, 'i')) || [])[1];
    out.push({ name: attr('name'), value: attr('value') ?? '', type: attr('type') || 'text' });
  }
  return out;
}

/** Автопоиск эндпоинтов/параметров в HTML страницы course_reg. */
function discover(html) {
  const uniq = (a) => [...new Set(a)].filter(Boolean);
  return {
    ajxCount: (html.match(/ajx=1/g) || []).length,
    actions: uniq([...html.matchAll(/action=([A-Za-z]\w{2,})/g)].map((m) => m[1])),
    showFunctions: uniq([...html.matchAll(/\b(Show[A-Z]\w+)/g)].map((m) => m[1])),
    mods: uniq([...html.matchAll(/mod=([\w-]+)/g)].map((m) => m[1])),
    programIds: uniq([...html.matchAll(/[?&'"]id=(\d{2,6})/g)].map((m) => m[1])),
    dk: uniq([...html.matchAll(/[?&'"]dk=([^&"' <>]+)/g)].map((m) => m[1])),
    pc: uniq([...html.matchAll(/[?&'"]pc=(\d{3,6})/g)].map((m) => m[1])),
    py: uniq([...html.matchAll(/[?&'"]py=(20\d{2})/g)].map((m) => m[1])),
    track: uniq([...html.matchAll(/track=([\w-]+)/g)].map((m) => m[1])),
    electiveCalls: uniq([...html.matchAll(/ShowElectiveCoursesByElCode\(([^)]{0,120})\)/g)].map((m) => m[1].trim())),
    // маркеры таблиц из «заметок друга» — проверяем, существуют ли они в реальном HTML
    markers: Object.fromEntries(
      ['relParent', 'clsTbl', 'tblSections', 'plTable', 'sectionNorm', 'sectionPractise']
        .map((k) => [k, (html.match(new RegExp(k, 'g')) || []).length]),
    ),
  };
}

// ------------------------------------------------------------------ ввод
async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(question)).trim();
  rl.close();
  return a;
}

async function askSecret(question) {
  const muted = new Writable({ write(_chunk, _enc, cb) { cb(); } });
  const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write(question);
  const a = (await rl.question('')).trim();
  rl.close();
  process.stdout.write('\n');
  return a;
}

// ------------------------------------------------------------------ сценарий
async function main() {
  log(`# SDU probe — дампы: ${outDir}\n`);

  // 1. Стартовая страница: PHPSESSID + форма логина
  const login = await req('GET', '/');
  dump('01-login-page.html', login);
  log(`[1] GET / -> ${login.status}; cookies: ${[...jar.keys()].join(', ') || 'none'}`);
  step('get-login-page', { status: login.status, cookieNames: [...jar.keys()] });

  // 2. Логин
  let user = process.env.SDU_USER;
  let pass = process.env.SDU_PASS;
  if (!user) user = await ask('SDU логин: ');
  if (!pass) pass = await askSecret('SDU пароль (скрытый ввод): ');

  const r2 = await req('POST', '/loginAuth.php', {
    form: { username: user, password: pass, modstring: '', LogIn: ' Log in ' },
    referer: BASE + '/',
  });
  dump('02-login-response.html', r2);
  log(`[2] POST /loginAuth.php -> ${r2.status}; location=${r2.location ?? '-'}; bytes=${r2.text.length}`);
  step('post-login', { status: r2.status, location: r2.location, bytes: r2.text.length });

  // Детект результата: 302 = успех (index.php — без 2FA, verification.php — нужна 2FA);
  // 200 = снова страница логина => неверные креды (проверено на практике).
  if (r2.status !== 302) {
    log('\n[!!] ЛОГИН НЕ ПРОШЁЛ: сервер вернул страницу логина (HTTP 200), редиректа нет.');
    log('     Проверь логин/пароль и запусти зонд ещё раз. Дальнейшие шаги бессмысленны.');
    step('login-result', { ok: false });
    finish(1);
    return;
  }

  const needs2fa = /verification/i.test(r2.location || '');
  log(`    => 2FA ${needs2fa ? 'ТРЕБУЕТСЯ (редирект на verification.php)' : 'не требуется (редирект на index.php)'}`);
  step('login-result', { ok: true, needs2fa });

  // 3. 2FA — читаем реальную форму, спрашиваем код, отправляем
  if (needs2fa) {
    const v = await req('GET', '/verification.php', { referer: BASE + '/loginAuth.php' });
    dump('03-verification-page.html', v);
    const fields = inputsOf(v.text);
    log(`[3] GET /verification.php -> ${v.status}; поля: ${fields.map((f) => `${f.name}(${f.type})`).join(', ')}`);
    step('get-verification', { status: v.status, fields: fields.map((f) => f.name) });

    const codeField = fields.find((f) => /code/i.test(f.name || '')) || fields.find((f) => f.type !== 'hidden');
    const code = await ask(`Код из письма (поле «${codeField?.name ?? 'code'}»): `);
    const form = {};
    for (const f of fields) if (f.name && f.type === 'hidden') form[f.name] = f.value;
    form[codeField?.name || 'code'] = code;

    const v2 = await req('POST', '/verification.php', { form, referer: BASE + '/verification.php' });
    dump('04-verification-response.html', v2);
    log(`    POST /verification.php -> ${v2.status}; location=${v2.location ?? '-'}`);
    step('post-verification', { status: v2.status, location: v2.location });
    if (v2.status !== 302) {
      log('\n[!!] Код, похоже, не принят (нет редиректа). Продолжаю — проверка сессии покажет точно.');
    }
  }

  // 4. Сессия живая?
  const after = await req('GET', '/', { referer: BASE + '/' });
  dump('05-main-after-login.html', after);
  const stillLogin = isLoginPage(after.text);
  const logoutSeen = /log\s*-?\s*out|выйти/i.test(after.text);
  log(`[4] GET / -> ${after.status}; логин-форма=${stillLogin ? 'ЕСТЬ (плохо)' : 'нет (хорошо)'}; logout-линк=${logoutSeen ? 'есть (хорошо)' : 'НЕТ (плохо)'}`);
  step('session-check', { status: after.status, stillLoginPage: stillLogin, logoutSeen });

  // 5. Главный дамп: course_reg
  const creg = await req('GET', '/index.php?mod=course_reg', { referer: BASE + '/index.php' });
  dump('06-course_reg.html', creg);
  const cregIsLogin = isLoginPage(creg.text);
  log(`[5] GET /index.php?mod=course_reg -> ${creg.status}; bytes=${creg.text.length}; ${cregIsLogin ? 'ЭТО СТРАНИЦА ЛОГИНА (сессия не принята!)' : 'похоже на реальную страницу записи на курсы'}`);
  step('get-course-reg', { status: creg.status, bytes: creg.text.length, isLoginPage: cregIsLogin });

  if (cregIsLogin) {
    log('\n[!!] course_reg отдал логин — сессия не работает. Пришли мне dumps/*/run.log, разберёмся.');
    finish(1);
    return;
  }

  // 6. Автопоиск эндпоинтов и параметров
  summary.discovered = discover(creg.text);
  fs.writeFileSync(path.join(outDir, '07-discovered.json'), JSON.stringify(summary.discovered, null, 2));
  const d = summary.discovered;
  log(`[6] Автопоиск в course_reg:`);
  log(`    ajx=1 упоминаний: ${d.ajxCount}`);
  log(`    actions: ${d.actions.join(', ') || '-'}`);
  log(`    Show*-функции: ${d.showFunctions.join(', ') || '-'}`);
  log(`    mods: ${d.mods.join(', ') || '-'}`);
  log(`    id (программы): ${d.programIds.slice(0, 8).join(', ') || '-'}`);
  log(`    dk: ${d.dk.slice(0, 8).join(', ') || '-'}`);
  log(`    pc: ${d.pc.slice(0, 8).join(', ') || '-'}`);
  log(`    py: ${d.py.slice(0, 8).join(', ') || '-'}`);
  log(`    track: ${d.track.slice(0, 8).join(', ') || '-'}`);
  log(`    маркеры таблиц из заметок: ${JSON.stringify(d.markers)}`);

  // 7. Проверка известных payload'ов (заметки «друга») с реально найденными параметрами
  const progId = d.programIds[0] || '1117';
  const dk = d.dk[0] || 'MDE 171';
  const pc = d.pc[0] || '10103';
  const py = d.py[0] || String(new Date().getFullYear());
  const track = d.track[0] || 'TRACK0';
  const cregUrl = `${BASE}/index.php?mod=course_reg`;

  const probes = [
    {
      name: 'ajx-searchtypes-POST',
      method: 'POST',
      form: { ajx: '1', mod: 'course_reg', action: 'ShowSearchTypesChanged', mtype: 'by_prog', id: progId, [String(Date.now())]: '' },
    },
    {
      name: 'ajx-sections-POST',
      method: 'POST',
      form: { ajx: '1', mod: 'course_reg', action: 'ShowAvailableAllSections', dk, pc, py, track, [String(Date.now())]: '' },
    },
    {
      name: 'ajx-searchtypes-GET',
      method: 'GET',
      url: `/index.php?ajx=1&mod=course_reg&action=ShowSearchTypesChanged&mtype=by_prog&id=${encodeURIComponent(progId)}&${Date.now()}=`,
    },
  ];

  for (const p of probes) {
    const r = p.method === 'POST'
      ? await req('POST', '/index.php', { form: p.form, xhr: true, referer: cregUrl })
      : await req('GET', p.url, { xhr: true, referer: cregUrl });
    dump(`${p.name}.raw.txt`, r);
    const desc = describeBody(r);
    log(`[7] ${p.method} ${p.name} -> ${r.status}; ${desc}`);
    summary.ajax.push({ name: p.name, method: p.method, params: p.form ?? p.url, status: r.status, body: desc });
  }

  log('\n# Зонд закончил работу.');
  finish(0);
}

function finish(code = 0) {
  summary.finishedAt = new Date().toISOString();
  summary.cookieNames = [...jar.keys()];
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  log(`\n# Все файлы: ${outDir}`);
  log('# me: пришли summary.json и run.log. Пароль в них не попадает; PHPSESSID есть только в HTML-дампах — их никуда не публикуй.');
  process.exit(code);
}

main().catch((e) => {
  log(`\n[!!] Ошибка: ${e && e.stack ? e.stack : e}`);
  finish(1);
});
