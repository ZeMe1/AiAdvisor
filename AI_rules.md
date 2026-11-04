# AI Rules & Architecture Specification

> [!CAUTION]
> **КРИТИЧЕСКОЕ ПРАВИЛО ДЛЯ ВСЕХ AI-АГЕНТОВ: ОБЯЗАТЕЛЬНОЕ ПОЛНОЕ ЧТЕНИЕ ПРОЕКТА ПЕРЕД НАЧАЛОМ РАБОТЫ**
> Любой AI-агент, открывший диалог или получивший новую задачу в этом репозитории, **ОБЯЗАН** перед выполнением каких-либо изменений, кодингом, фиксами или рефакторингом **ПРОЧИТАТЬ ВЕСЬ ПРОЕКТ ЦЕЛИКОМ**:
> 1. Прочитать **ВСЕ файлы документации `.md`** (`AI_rules.md`, `README.md`, `.gemini/rules/session-management-freeze.md`).
> 2. Прочитать и изучить **ВСЕ директории и файлы** в проекте: структуру бэкенда (`server/`), скрапера SDU (`src/sdu/`), фронтенда (`web/src/`), тестов (`test/`) и скриптов (`scripts/`, `tools/`).
> 3. Досконально разобраться в **Session Management**, механике выполнения внешних запросов к порталу SDU, двухуровневом кэшировании и связях таблиц БД в `server/db.mjs`.
> 4. **КАТЕГОРИЧЕСКИ ЗАПРЕЩАЕТСЯ** делать правки «вслепую» без предварительного чтения связанных модулей.
> 5. > [!CAUTION]
> **НЕМЕДЛЕННЫЙ ПРОТОКОЛ ЧТЕНИЯ ПРОЕКТА (EXECUTION TRIGGER: IMMEDIATE)**
>
> 1.**МОМЕНТ СРАБАТЫВАНИЯ (ZERO-STEP TRIGGER)**:
     >    Если пользователь открыл сессию или сказал «прочитай AI_rules.md» (даже БЕЗ задачи на кодинг), агент **НЕ ИМЕЕТ ПРАВА** отвечать пользователю текстом «готов» или задавать вопросы, пока в этом же ходу физически не вызовет инструменты чтения кода.
>
> 2.**ОБЯЗАТЕЛЬНЫЙ АЛГОРИТМ ДЕЙСТВИЙ АГЕНТА В ПЕРВОМ ЖЕ ОТВЕТЕ**:
>    - Шаг 1: Найти все файлы проекта командой:
       >      `Get-ChildItem -Path server,src,web\src,test -Recurse -File | Where-Object { $_.FullName -notmatch "node_modules|\.git|dist" }`
    >    - Шаг 2: Прочитать через `read_file` все ключевые модули:
    >      - `server/db.mjs`, все контроллеры, репозитории, сервисы и middleware.
        >      - `src/sdu/client.js` и все парсеры в `src/sdu/parsers/`.
        >      - `web/src/stores/*`, `web/src/pages/*`, `web/src/components/*`.
    >    - Шаг 3: Запустить `npm test` и `npm run web:build`.
>
> 3.**КРИТЕРИЙ ВЫПОЛНЕНИЯ (PROOF OF WORK)**:
     >    Ответ агента после прочтения AI_rules.md ОБЯЗАН содержать подробную сводку прочитанных модулей по слоям (бэкенд, SDU-клиент, фронтенд Zustand/React, тесты). Ответ без перечисления изученных файлов считается нарушением протокола.

---

## 0. Чек-лист онбординга агента (Mandatory Onboarding Protocol)

Каждый новый агент в сессии **ДОЛЖЕН** мысленно или явно подтвердить прохождение следующих шагов:

- [ ] **Чтение всех `.md` файлов**: изучить `AI_rules.md`, `README.md`, `.gemini/rules/*.md`.
- [ ] **Изучение Session Management**: понять, почему локальная сессия (`zeme_session`) и внешняя сессия SDU (`PHPSESSID`) разделены, где хранятся куки, и почему нельзя удалять куки при ошибках внешнего портала SDU.
- [ ] **Изучение механизма запросов к SDU**: понять, как устроен клиент `src/sdu/client.js`, почему запросы отправляются строго через POST с `ajx=1` в теле (form urlencoded), и как работают парсеры в `src/sdu/parsers/`.
- [ ] **Изучение кэширования**: понять двухуровневую систему кэша (Client-side `localStorage` + Server-side PostgreSQL Stale-While-Revalidate).
- [ ] **Изучение схемы базы данных**: изучить все таблицы в `server/db.mjs` (`users`, `sessions`, `student_data_cache`, `curriculum_cache`, `course_sections_cache`, `student_groups`, `group_members`, `curriculums`, `curriculum_assignments`, `recommendation_feedback`).
- [ ] **Изучение фронтенда**: изучить стейт-менеджеры Zustand (`web/src/stores/authStore.js`, `scheduleStore.js`, `planStore.js`), роутинг в `web/src/App.jsx` и API-клиент `web/src/api.js`.
- [ ] **Изучение UI правил**: строго соблюдать English-only интерфейс и контрастность цветов.
- [ ] **Тестовый прогон**: запускать `npm test` после любых изменений и сохранять 100% прохождение тестов.

---

## 1. Общая структура проекта и карта директорий

```
AiAdvisor/
├── server/                     # Express 5 REST API сервер
│   ├── controllers/            # Контроллеры запросов (auth, schedule, user, admin)
│   ├── errors/                 # HttpError и типизированные ошибки
│   ├── middlewares/            # session, auth, error, rate-limit middleware
│   ├── repositories/           # Прямой доступ к PostgreSQL через pg pool
│   ├── routes/                 # Маршруты Express (/api/auth, /api/admin, /api/*)
│   ├── schemas/                # Валидация входных данных через Zod
│   ├── services/               # Бизнес-логика (schedule, auth, user, group, curriculum, recommendation)
│   ├── db.mjs                  # Инициализация PostgreSQL пула и всех таблиц/индексов
│   ├── demo-data.mjs           # Статичные моки для демонстрационного режима (DEMO=1)
│   └── index.mjs               # Входной файл Express приложения
├── src/sdu/                    # Модуль интеграции со студенческим порталом SDU (my.sdu.edu.kz)
│   ├── parsers/                # Cheerio-парсеры HTML и JSON ответов портала
│   │   ├── curriculum.js       # Парсер учебного плана программы (mtype=by_prog)
│   │   ├── registrations.js    # Парсер страницы course_reg (утвержденные курсы, трек)
│   │   ├── schedule.js         # Парсер расписания и временных слотов
│   │   └── sections.js         # Парсер секций (теория/практика/лабы, преподаватели, квоты)
│   └── client.js               # Низкоуровневый HTTP-клиент (undici Pool), куки-джар, 2FA, ajx-вызовы
├── web/                        # Frontend приложение (Vite + React)
│   ├── src/
│   │   ├── components/         # UI-компоненты (Curriculum, Basket, ScheduleGrid, SectionTable, Login, 2FA, etc.)
│   │   ├── pages/              # Страницы роутера (HomePage, CoursePage, ElectivesPage, RoadmapPage, AdminPage, etc.)
│   │   ├── shared/ui/          # Переиспользуемые атомарные UI элементы (Navbar, Toast, ConfirmModal, EligibilityBadge)
│   │   ├── stores/             # Глобальный стейт Zustand (authStore, scheduleStore, planStore)
│   │   ├── api.js              # Fetch-клиент к нашему /api бэкенду
│   │   ├── schedule.js         # Сетка расписания, детекция конфликтов времени и слотов
│   │   ├── styles.css          # Основные CSS стили и дизайн-токены ZeMe
│   │   ├── App.jsx             # Корневой компонент с React Router и Auth Gate
│   │   └── main.jsx            # Точка входа React
├── test/                       # Интеграционные и модульные тесты (Vitest + Supertest)
│   ├── api.test.mjs            # Тесты API, защиты сессий и обработки ошибок
│   ├── curriculum.test.mjs     # Тесты импорта и назначения учебных планов
│   ├── groups.test.mjs         # Тесты управления академическими группами и эдвайзерами
│   ├── recommendations.test.mjs# Тесты рекомендаций курсов и фидбека (лайки/дизлайки)
│   └── *.test.mjs              # Парсеры, расписание, prerequisites
├── tools/                      # Зонды и диагностические утилиты для исследования портала SDU
├── scripts/                    # Скрипты администрирования (elevate-user.mjs и др.)
├── AI_rules.md                 # ГЛАВНЫЙ СВОД ПРАВИЛ И АРХИТЕКТУРЫ (ЭТОТ ФАЙЛ)
└── README.md                   # Руководство пользователя и разработчика
```

---

## 2. Защищённые файлы (СТРОЖАЙШИЙ ЗАПРЕТ НА ИЗМЕНЕНИЕ БЕЗ ЯВНОГО ТРЕБОВАНИЯ)

Запрещено вносить изменения, рефакторить или удалять логику авторизации, сессий и отказоустойчивости в файлах:
- `server/middlewares/auth.middleware.mjs`
- `server/middlewares/error.middleware.mjs`
- `server/services/auth.service.mjs`
- `server/services/schedule.service.mjs` (логика fallback, Stale-While-Revalidate и вызовы SDU)
- `server/repositories/session.repository.mjs`
- `server/repositories/cache.repository.mjs`
- `src/sdu/client.js`
- `src/sdu/parsers/curriculum.js`
- `web/src/stores/authStore.js`
- `web/src/stores/scheduleStore.js`
- `web/src/pages/ElectivesPage.jsx` (обработка ошибок и восстановление стейта)
- `web/src/pages/CoursePage.jsx`
- `web/src/App.jsx` (auth gate)

---

## 3. Архитектура Session Management: Как устроена авторизация

### 3.1. Разделение локальной сессии и внешней SDU-сессии (Dual Session)
В проекте реализовано фундаментальное архитектурное разделение:
1. **Локальная сессия ZeMe**:
   - Хранится в таблице `sessions` в PostgreSQL.
   - Идентифицируется криптографически стойким токеном через HTTP-only cookie `zeme_session`.
   - Имеет срок жизни **7 дней** (`expires_at = NOW() + INTERVAL '7 days'`).
   - Пока локальная сессия активна в PostgreSQL, пользователь считается полностью авторизованным в приложении ZeMe.
2. **Upstream-сессия SDU (`PHPSESSID`)**:
   - Внешний портал `my.sdu.edu.kz` написан на PHP и **принудительно сбрасывает `PHPSESSID`** при любом параллельном входе, таймауте неактивности (~15 минут) или технических сбоях портала.
   - Сессионный Cookie Jar портала SDU сериализуется в JSONB-поле `sdu_jar` таблицы `sessions` в Postgres.

### 3.2. Главное правило защиты сессии (`errorHandler` & Fallback)
- **ЗАПРЕЩЕНО СБРАСЫВАТЬ АВТОРИЗАЦИЮ ПРИ СБОЯХ SDU**:
  Когда внешний портал SDU возвращает 302 на `login.php`, `loginAuth.php`, `verification.php` или ошибку `ajx` (`sessionExpired`), сервер ZeMe:
  1. **НЕ удаляет** запись из таблицы `sessions`.
  2. **НЕ вызывает** `res.clearCookie('zeme_session')`.
  3. Отдает закэшированные данные из PostgreSQL (`cacheRepository.*(..., Infinity)`) по принципу **Stale-While-Revalidate**.
  4. Студент продолжает беспрепятственно работать с расписанием, куррикулумом, планом и роадмапом.
- На фронтенде вторичные вызовы (загрузка секций, элективов, курсов, профиля, поиска) **НИКОГДА не должны вызывать `handleAuthError(err)`** и не должны сбрасывать стейт авторизации (`stage = 'login'`).

---

## 4. Как выполняются сетевые запросы к порталу SDU

Все сетевые обращения к `my.sdu.edu.kz` сосредоточены исключительно в `src/sdu/client.js` и построены на результатах реального реверс-инжиниринга:
1. **Строго POST с параметрами в теле (form-urlencoded)**:
   - Внешний портал SDU обрабатывает динамические данные через единую точку входа: `POST /index.php`.
   - В теле запроса **ОБЯЗАТЕЛЬНО** передается `ajx=1&mod=course_reg&action=<ActionName>`.
   - **ВНИМАНИЕ**: если отправить параметры через GET query string или с пустым телом, портал вернет HTTP 200 с пустым ответом!
2. **JSON-структура ответов**:
   - Ответ портала приходит в виде JSON: `{"CODE": "1", "DATA": "...", "DATA2": [...]}`.
   - Поле `DATA2` содержит сырой массив секций, а `DATA` содержит сопутствующий HTML.
3. **Двухфакторная аутентификация (2FA)**:
   - Шаг 1: `POST /loginAuth.php` (`username`, `password`, `modstring`, `LogIn`).
   - Если требуется 2FA — портал возвращает 302 на `verification.php`. Сервер переводит сессию в статус `2fa_required`.
   - Шаг 2: Студент вводит код из почты -> `POST /verification.php` (`code`), после чего кука сессии валидируется и сохраняется в `sdu_jar`.

---

## 5. Двухуровневое кэширование (Local-First Offline-Resilience)

Система построена по образцу высоконагруженных устойчивых приложений: **минимум сетевых запросов, максимум локальной скорости**.

### Уровень 1: Frontend (`localStorage`)
- **Кэш куррикулума (`zeme_curriculum_cache_v1`)**:
  - Сохраняется в `localStorage` при первом входе студента.
  - При перезагрузке страницы (F5) куррикулум восстанавливается мгновенно с нулевой задержкой (0 мс).
  - Стирается **исключительно** при явном нажатии Logout (`useAuthStore.getState().logout()`).
- **Кэш секций курсов (`zeme_courses_cache_v1`)**:
  - Реализован в `web/src/stores/scheduleStore.js`.
  - При первом открытии курса его секции кэшируются. Повторные клики и переключения между курсами читаются из кэша мгновенно без сетевых вызовов.

### Уровень 2: Backend PostgreSQL Cache (Stale-While-Revalidate)
- Таблица `course_sections_cache`: секции курсов (TTL 4 часа).
- Таблица `student_data_cache`: данные студента, утвержденные курсы, корзина (TTL 2 часа).
- Таблица `curriculum_cache`: распарсенные учебные планы (TTL 24 часа).
- При недоступности или истечении сессии SDU бэкенд возвращает stale-данные с флагом `Infinity`, гарантируя непрерывность пользовательского опыта.

---

## 6. База данных и схема данных (`server/db.mjs`)

База данных работает на PostgreSQL (Neon / локальный Postgres). Основные сущности:
1. `users`: локальные пользователи (`username`, `password_hash`, `display_name`, `avatar_url`, `role` ['Student', 'Advisor', 'Admin'], `is_blocked`).
2. `sessions`: сессии пользователей (`id`, `user_id`, `username`, `role`, `status`, `sdu_jar`, `expires_at`).
3. `student_data_cache`, `curriculum_cache`, `course_sections_cache`: таблицы кэширования ответов SDU.
4. `student_groups`: группы студентов (`name`, `program`, `study_year`, `advisor_username`).
5. `group_members`: привязка студентов к группе (один студент состоит максимум в одной группе).
6. `curriculums` & `curriculum_assignments`: импортированные администратором учебные планы и их назначение группам/студентам.
7. `recommendation_feedback`: фидбек по рекомендациям курсов (`student_username`, `course_code`, `status` ['interested', 'not_interested']).

---

## 7. Правила интерфейса и локализации (UI & Design Rules)

1. **Strictly English Only for UI**:
   - **ВСЕ** тексты пользовательского интерфейса, кнопки, названия вкладок, бейджи, подсказки (tooltips), модальные окна, тосты (toasts) и сообщения об ошибках **ДОЛЖНЫ БЫТЬ СТРОГО НА АНГЛИЙСКОМ ЯЗЫКЕ (English)**.
   - Использование русского языка в UI элементах категорически запрещено.
2. **Контрастность и цветовая палитра**:
   - **ЗАПРЕЩЕНО** использовать серый текст на белом фоне или размытые малоконтрастные цвета.
   - Использовать переменные темы проекта: `#002B49` (SDU Navy), `#0070BA` (Accent Blue), `#00A859` (Success Green), `#D9381E` (Warning/Danger Red).
   - Кнопки внутри карточек и списков должны оформляться классами `.btn.btn-mini` или `.btn-primary` с четкими границами и читаемым цветом текста.

---

## 8. Тестирование и гарантия работоспособности

- Перед завершением любой задачи агент **ОБЯЗАН** запустить тесты:
  ```bash
  npm test
  ```
- Все тесты (50+ тестов во всех test files: `api`, `curriculum`, `groups`, `recommendations`, `schedule`, `parsers`, `prerequisites`, `eligibility`) должны завершаться со статусом **PASS**.
- Если из-за правок падает хоть один тест — задача считается невыполненной до устранения ошибки.
- При изменении фронтенда обязательно проверять сборку:
  ```bash
  npm run web:build
  ```
