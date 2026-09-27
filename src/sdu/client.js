/**
 * Клиент портала my.sdu.edu.kz для одной пользовательской сессии.
 * Держит cookie-jar (PHPSESSID), выполняет логин/2FA и тянет данные.
 * Пароль нигде не сохраняется и не логируется.
 */

import dns from 'node:dns';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { parseCourseRegPage } from './parsers/registrations.js';
import { parseCurriculumHtml } from './parsers/curriculum.js';
import { parseSectionsResponse } from './parsers/sections.js';
import { parseElectivesResponse } from './parsers/electives.js';

const BASE = 'https://my.sdu.edu.kz';
const UA = 'ZeMe/1.0 (SDU schedule planner)';

// ---------------------------------------------------------------- DNS
// Системный getaddrinfo на serverless (Vercel) периодически отдаёт закэшированный
// негативный ответ по .kz-домену — все ретраи запроса падают с ENOTFOUND.
// Поэтому портал резолвим сами, слоями в обход системного резолвера:
//   1) кэш в процессе   2) публичные DNS (UDP)   3) DoH по HTTPS
//   4) последний известный IP   5) зашитый IP портала
// SNI/Host всегда остаются my.sdu.edu.kz, поэтому TLS валиден на любом слое.
const DNS_TTL_MS = 5 * 60_000;               // свежий кэш
const DNS_STALE_MS = 7 * 24 * 60 * 60_000;   // просроченный, но пригодный как фолбэк
const PUBLIC_DNS = (process.env.ZEME_DNS || '8.8.8.8,1.1.1.1,8.8.4.4').split(',');
const PINNED_IPS = new Map([['my.sdu.edu.kz', '92.47.198.154']]); // проверен 2026-09

const dnsCache = new Map(); // hostname -> { ip, ts }
const publicResolver = new dns.Resolver({ timeout: 2000, tries: 1 });
publicResolver.setServers(PUBLIC_DNS);

const resolveViaPublicDns = (hostname) =>
  new Promise((resolve, reject) => {
    publicResolver.resolve4(hostname, (err, addrs) => {
      if (err || !addrs?.length) reject(err ?? new Error('нет A-записи'));
      else resolve(addrs[0]);
    });
  });

async function resolveViaDoh(hostname) {
  // 1.1.1.1 отдаёт валидный TLS-сертификат прямо на IP, поэтому доступна даже
  // при полностью мёртвом системном резолвере; dns.google — второй эндпоинт.
  const endpoints = [
    `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
  ];
  let lastErr;
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'application/dns-json' },
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) throw new Error(`DoH HTTP ${r.status}`);
      const answer = (await r.json()).Answer ?? [];
      const ip = answer.find((a) => a.type === 1)?.data; // type 1 = A-запись
      if (!ip) throw new Error('DoH: нет A-записи');
      return ip;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** lookup для undici: IPv4-only, публичные резолверы, кэш и фолбэки. */
function resilientLookup(hostname, options, callback) {
  const respond = (ip) => {
    // undici вызывает lookup и в режиме all:true — там ждут массив [{address, family}]
    if (options?.all) callback(null, [{ address: ip, family: 4 }]);
    else callback(null, ip, 4);
  };
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.ts < DNS_TTL_MS) {
    respond(cached.ip);
    return;
  }
  (async () => {
    for (const resolve of [resolveViaPublicDns, resolveViaDoh]) {
      try {
        const ip = await resolve(hostname);
        dnsCache.set(hostname, { ip, ts: Date.now() });
        respond(ip);
        return;
      } catch { /* следующий слой */ }
    }
    if (cached && Date.now() - cached.ts < DNS_STALE_MS) return respond(cached.ip);
    const pinned = PINNED_IPS.get(hostname);
    if (pinned) return respond(pinned);
    callback(Object.assign(new Error(`ENOTFOUND: ${hostname} не резолвится ни одним способом`), { code: 'ENOTFOUND' }));
  })();
}

const proxyUrl = process.env.SDU_PROXY || process.env.HTTPS_PROXY;
const dispatcher = proxyUrl
  ? new ProxyAgent(proxyUrl) // DNS резолвит прокси
  : new Agent({ connect: { lookup: resilientLookup }, headersTimeout: 30_000, bodyTimeout: 30_000 });

export class SduClient {
  constructor() {
    this.jar = new Map(); // cookie name -> value
    this.status = 'anonymous'; // anonymous | pending_2fa | authed
  }

  #cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  #absorb(res) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }

  async #req(method, path, { form, referer, xhr } = {}) {
    const url = path.startsWith('http') ? path : BASE + path;
    const headers = { 'User-Agent': UA, Accept: 'text/html,application/json,*/*' };
    if (this.jar.size) headers.Cookie = this.#cookieHeader();
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (referer) headers.Referer = referer;
    if (xhr) headers['X-Requested-With'] = 'XMLHttpRequest';
    const body = form ? new URLSearchParams(form).toString() : undefined;

    // Портал (Apache) рвёт keep-alive соединения после ~5с простоя: запрос по
    // протухшему сокету падает с "fetch failed". Ретраи открывают свежие сокеты.
    const RETRIES = 3;
    let lastErr;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      try {
        const res = await undiciFetch(url, { method, headers, body, redirect: 'manual', dispatcher });
        this.#absorb(res);
        return {
          status: res.status,
          location: res.headers.get('location'),
          contentType: res.headers.get('content-type') || '',
          text: await res.text(),
        };
      } catch (e) {
        lastErr = e;
        if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    }
    const cause = lastErr?.cause?.code || lastErr?.cause?.message || '';
    const hint = cause.includes('ENOTFOUND')
      ? 'DNS не нашёл адрес портала — проверьте VPN/DNS и попробуйте ещё раз'
      : 'проверьте сеть и попробуйте ещё раз';
    throw new Error(`Не удалось связаться с порталом SDU (${cause || lastErr?.message}). ${hint}`);
  }

  /** POST /loginAuth.php. 302 -> index.php: 2FA не нужна; 302 -> verification.php: нужна. */
  async login(username, password) {
    await this.#req('GET', '/'); // фиксируем PHPSESSID до логина
    const r = await this.#req('POST', '/loginAuth.php', {
      form: { username, password, modstring: '', LogIn: ' Log in ' },
      referer: `${BASE}/`,
    });
    if (r.status !== 302) return { ok: false, reason: 'bad_credentials' };
    if (/verification/i.test(r.location || '')) {
      // Сразу открываем страницу 2FA, как браузер: валидируем связь и состояние сессии,
      // чтобы ошибка сети всплыла здесь, а не при отправке кода.
      await this.#req('GET', '/verification.php', { referer: `${BASE}/loginAuth.php` });
      this.status = 'pending_2fa';
      return { ok: true, needs2fa: true };
    }
    this.status = 'authed';
    return { ok: true, needs2fa: false };
  }

  /** POST /verification.php с 6-значным кодом из письма. */
  async submit2fa(code) {
    const r = await this.#req('POST', '/verification.php', {
      form: { code },
      referer: `${BASE}/verification.php`,
    });
    if (r.status !== 302) return { ok: false, reason: 'bad_code' };
    await this.#req('GET', r.location || '/loginAuth.php?verified=1');
    this.status = 'authed';
    return { ok: true };
  }

  /**
   * ajx-запрос к порталу. Все параметры — в теле POST (form-urlencoded),
   * URL — голый /index.php. Параметры в URL портал игнорирует и отдаёт
   * пустой ответ (проверено зондом: POST с телом -> CODE=1, GET/пустое тело -> пусто).
   */
  async #ajx(action, params) {
    const form = { ajx: '1', mod: 'course_reg', action, ...params };
    form[String(Date.now())] = ''; // cache-buster, как на портале
    const r = await this.#req('POST', '/index.php', {
      form,
      xhr: true,
      referer: `${BASE}/index.php?mod=course_reg`,
    });
    if (r.status !== 200) throw new Error(`SDU ajx ${action}: HTTP ${r.status}`);
    let json;
    try {
      json = JSON.parse(r.text);
    } catch {
      // умершая сессия: портал отдаёт страницу логина вместо JSON-конверта
      if (/name="password"|loginAuth\.php/i.test(r.text)) {
        this.status = 'anonymous';
        const e = new Error('Сессия портала истекла');
        e.sessionExpired = true;
        throw e;
      }
      const excerpt = r.text.slice(0, 100).replace(/\s+/g, ' ').trim();
      throw new Error(`SDU ajx ${action}: ${r.text.length ? `неожиданный ответ (${excerpt}…)` : 'пустой ответ портала'}`);
    }
    return json;
  }

  /** Страница Course Registration: term, трек, утверждённые/корзина. */
  async getCourseReg() {
    const r = await this.#req('GET', '/index.php?mod=course_reg', { referer: `${BASE}/index.php` });
    return parseCourseRegPage(r.text);
  }

  /** Куррикулум программы (mtype=by_prog, id = id трека из /api/me). */
  async getCurriculum(trackId) {
    const json = await this.#ajx('ShowSearchTypesChanged', { mtype: 'by_prog', id: trackId });
    if (String(json.CODE) !== '1') throw new Error(`ShowSearchTypesChanged: CODE=${json.CODE}`);
    return parseCurriculumHtml(json.DATA);
  }

  /**
   * Секции курса. mufSqId обязателен для курсов из элективной группы —
   * портал добавляет &muf_sq_id=... (переменная elave в его JS).
   * Сначала текущий год (живые квоты — проверено зондом),
   * при неудаче — progYear из куррикулума.
   */
  async getSections({ dk, pc, py, track, mufSqId }) {
    const years = [...new Set([new Date().getFullYear(), py].filter(Boolean))];
    const base = {
      dk, pc: pc ?? '', track: track ?? 'TRACK0',
      ...(mufSqId ? { muf_sq_id: mufSqId } : {}),
    };
    let last;
    for (const y of years) {
      const json = await this.#ajx('ShowAvailableAllSections', { ...base, py: y });
      if (String(json.CODE) === '1') return { ...parseSectionsResponse(json), requestedYear: y };
      last = json;
    }
    throw new Error(`ShowAvailableAllSections ${dk}: CODE=${last?.CODE} (${last?.DATA ?? 'нет данных'})`);
  }

  /** Поиск курса по коду (третий способ на портале). Ответ того же формата, что и секции. */
  async searchCourse(dk, track) {
    const json = await this.#ajx('SearchCourse', { dk, track: track ?? 'TRACK0' });
    if (String(json.CODE) !== '1') throw new Error(`SearchCourse ${dk}: CODE=${json.CODE}`);
    return parseSectionsResponse(json);
  }

  /**
   * Список курсов элективной группы (заглушки XXX 10X и т.п.).
   * Имена параметров — ровно как в URL у JS портала:
   * dk, muf_sq_id, period_no, group_title, pc, py, track, ctp, lg, type.
   */
  async getElectiveCourses({ dk, mufSqId, periodNo, groupTitle, pc, py, track, codeType, lgCode, type, fallbackCodes }) {
    const json = await this.#ajx('ShowElectiveCoursesByElCode', {
      sentFrom: 'NewReqByProgram',
      dk,
      muf_sq_id: mufSqId ?? '',
      period_no: periodNo ?? '',
      group_title: groupTitle ?? '',
      pc: pc ?? '',
      py: py ?? '',
      track: track ?? 'TRACK0',
      ctp: codeType ?? 'R',
      lg: lgCode ?? '',
      type: type ?? 'NAE',
    });
    return parseElectivesResponse(json, fallbackCodes);
  }
}
