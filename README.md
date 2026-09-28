# AiAdvisor — планировщик расписания SDU

Веб-приложение для студентов SDU University: логин через портал
[my.sdu.edu.kz](https://my.sdu.edu.kz) (с 2FA), куррикулум программы, выбор
секций (теория/практика) с живыми квотами и недельная сетка расписания с
детектом конфликтов. Планирование происходит **только локально** — в SDU ничего
не записывается.

## Быстрый старт

```bash
npm install          # зависимости сервера
npm --prefix web install   # зависимости фронта (один раз)
npm start            # сборка фронта + запуск сервера в боевом режиме
```

Открыть: **http://localhost:3001** — ввести логин/пароль портала SDU,
при необходимости код 2FA из письма на студенческую почту.

Демо-режим (без логина, данные из дампов):

```bash
npm run demo         # DEMO=1, http://localhost:3001
```

Разработка фронта с hot-reload:

```bash
npm run server       # API на :3001 (боевой)
npm run web:dev      # Vite на :5173, проксирует /api на :3001
```

## Деплой на Vercel

Приложение работает на Vercel в serverless-режиме: `api/index.js` — тот же
Express-приложение, статика — `web/dist`. Состояние сессии SDU хранится в
подписанной HMAC HttpOnly-куке `zeme_sdu` (не в памяти процесса), поэтому
холодные инстансы ничего не теряют. `dumps/` исключён из деплоя через
`.vercelignore`.

```bash
npm i -g vercel
vercel login
vercel link                    # создать/привязать проект (имя zeme)
vercel env add SESSION_SECRET  # длинная случайная строка, см. ниже
vercel --prod
```

`SESSION_SECRET` — произвольная длинная случайная строка (например,
`openssl rand -hex 32`); ею подписывается cookie сессии. Без неё сервер
генерирует временный секрет на процесс (сессии будут сбрасываться между
холодными стартами — для локальной разработки достаточно).

## Что внутри

```
server/index.mjs        Express API + статика web/dist; сессии в памяти
server/demo-data.mjs    DEMO=1 — ответы из dumps/, без обращения к порталу
src/sdu/client.js       Клиент портала: cookie-jar, login, 2FA, ajx-запросы
src/sdu/parsers/        Парсеры: curriculum / sections / registrations
web/                    React + Vite фронт
tools/probe-sdu.mjs     Зонд портала: собирает сырые дампы в dumps/
tools/test-parsers.mjs  Прогон парсеров по дампам (npm test)
```

## Наше API

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/auth/login` | `{username, password}` → `{status: "ok" \| "2fa_required"}` |
| POST | `/api/auth/2fa` | `{code}` (6 цифр) → `{status: "ok"}` |
| POST | `/api/auth/logout` | сброс сессии |
| GET | `/api/me` | семестр, трек, корзина/утверждённые, расписание корзины |
| GET | `/api/curriculum` | куррикулум: программа → семестры → курсы |
| GET | `/api/sections?code=` | секции курса (теория/практика/лабы, квоты, время) |
| GET | `/api/search?code=` | поиск курса по коду |

Сессия нашего сайта — cookie `zeme_sid`; внутри процесса она держит `PHPSESSID`
портала. Пароли не сохраняются и не логируются.

## Как устроен портал SDU (выяснено зондом)

- Логин: `POST /loginAuth.php` (`username`, `password`, `modstring`, `LogIn`).
  Ответ **302**: `index.php` — 2FA не нужна, `verification.php` — нужна.
  Неверные креды → 200 и снова страница логина.
- 2FA: `POST /verification.php` (`code`) → 302 на `loginAuth.php?verified=1`.
- Данные: `POST /index.php` с параметрами **в теле формы**
  (`ajx=1&mod=course_reg&action=...`, только POST!) → JSON
  `{"CODE","DATA","DATA2","DATA3"}`; **DATA2 — уже готовый JSON секций**,
  HTML из DATA нужен только для названий/куррикулума.
  Если послать параметры в URL (или POST с пустым телом), портал вернёт
  HTTP 200 с **пустым телом** — проверено зондом.
- Ключевые action: `ShowSearchTypesChanged` (куррикулум, `mtype=by_prog`,
  `id`=id трека), `ShowAvailableAllSections` (`dk`, `pc`, `py`, `track`),
  `SearchCourse` (`dk`, `track`).

## Безопасность / ограничения

- Расписание дня в SDU: `1=Пн … 7=Вс`, время начала пары `Д.ЧЧ:ММ`.
- Слоты сетки: 08:30–21:30 по 50 минут (как на портале).
- `dumps/` в `.gitignore`: там PHPSESSID и персональные данные.
- Запись на курсы (AddCourse) сознательно **не реализована** — только планирование.
