# AI Rules & Session Management Architecture

> [!CAUTION]
> **СТРОЖАЙШИЙ ЗАПРЕТ НА ИЗМЕНЕНИЕ АВТОРИЗАЦИИ И SESSION MANAGEMENT**
> Любым AI-агентам, разработчикам и скриптам **ЗАПРЕЩЕНО** менять, удалять, рефакторить или «оптимизировать» логику аутентификации, хранения сессий, обработки ошибок сессий и двухуровневого кэширования. 
> Эта архитектура полностью отлажена, проверена тестами и обеспечивает стабильную работу без вылетов даже при нестабильном или сброшенном upstream-портале SDU.

---

## 1. Защищённые файлы (DO NOT TOUCH)
Запрещено вносить изменения в логику авторизации и управления сессиями в следующих файлах:
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

## 2. Архитектура: как устроен Session Management

### 2.1. Разделение локальной сессии и SDU-сессии
1. **Локальная сессия ZeMe**:
   - Живёт в базе данных PostgreSQL (таблица `sessions`), идентифицируется по `id` через HTTP-only cookie `zeme_session`.
   - Имеет долгий срок жизни (7 дней).
   - Пользователь авторизован в ZeMe до тех пор, пока валидна локальная сессия в базе данных.
2. **Upstream-сессия SDU (`PHPSESSID`)**:
   - Портал my.sdu.edu.kz держит сессию в PHP и **принудительно сбрасывает её** при любом стороннем входе с тем же логином или по короткому таймауту неактивности (~15 мин).
   - `PHPSESSID` сохраняется внутри записи сессии в PostgreSQL.
3. **Правило защиты локальной сессии (`errorHandler`)**:
   - Когда SDU сообщает `sessionExpired` (302-редирект на `login.php` или `ajx` ошибка), сервер ZeMe **НЕ удаляет локальную сессию** из PostgreSQL и **НЕ удаляет cookie** у пользователя (`res.clearCookie` запрещён).
   - Пользователь остаётся авторизован в системе ZeMe.

---

### 2.2. Двухуровневое кэширование (Local-First Offline-Resilience)
По образцу `javazhan.tech`, система сводит сетевые обращения к SDU к абсолютному минимуму: один раз загрузить — дальше работать локально.

#### Уровень 1: Frontend (`localStorage`)
- **Кэш секций курсов (`zeme_courses_cache_v1`)**:
  - Реализован в `web/src/stores/scheduleStore.js`.
  - При первом открытии курса секции кэшируются в `localStorage`.
  - При последующих кликах по предметам, переключениях секций или возвратах назад запрос в сеть **вообще не отправляется** (0 мс отклик).
  - Если сеть недоступна или SDU-сессия сброшена, курс мгновенно читается из `localStorage`.
  - `loadCourse` **никогда не вызывает** `handleAuthError(err)`, чтобы сбой конкретного курса не разлогинивал пользователя.
- **Кэш куррикулума (`zeme_curriculum_cache_v1`)**:
  - Сохраняется в `localStorage` при первом входе.
  - Обеспечивает мгновенную отрисовку предметов и расписания при перезагрузке (F5).
  - Стирается **только при явном нажатии Logout** в `authStore.logout()`.

#### Уровень 2: Backend PostgreSQL Cache (Stale-While-Revalidate)
- **`sections_cache`**: TTL 4 часа.
- **`students_cache`**: TTL 2 часа.
- Если SDU недоступен или вернул `sessionExpired`, методы `getMe()`, `getCurriculum()`, `getSections()` достают закэшированные данные из PostgreSQL (`cacheRepository.*(..., Infinity)`) и возвращают их клиенту, не выбрасывая ошибку разлогина.

---

### 2.3. Роутинг и обработка элективов (`/electives/:code`)
1. **Парсинг кандидатов**:
   - SDU отдаёт кандидатов через слэши (`INF 362/INF 391/ CSS 375...`). В `src/sdu/parsers/curriculum.js` парсер сплитит коды строго по регулярному выражению `/[,/]/`.
2. **Передача `mufSqId`**:
   - При переходе на электив в URL передаётся query-параметр: `/electives/XXX%20XXX?mufSqId=8245`.
   - При прямом переходе по ссылке или перезагрузке страницы (F5) `ElectivesPage.jsx` восстанавливает объект курса из закэшированного куррикулума по `mufSqId` или коду.
3. **Безотказность элективов**:
   - Бекенд `POST /api/electives` обёрнут в `try/catch`. Если вызов к SDU падает, сервер возвращает статус 200 со списком кодов-кандидатов из учебного плана.
   - В `ElectivesPage.jsx` **запрещено вызывать `handleAuthError(err)`**. Ошибка электива не должна переводить пользователя на форму логина и блокировать переход в `/profile`.

---

## 3. Правила для AI-агентов
1. **Никогда не сбрасывать `stage = 'login'`** на ошибках вторичных запросов (секции, элективы, поиск, профиль).
2. **Никогда не удалять `zeme_session` cookie** при ошибках внешнего портала SDU.
3. **Никогда не отключать `localStorage` кэш** в `scheduleStore.js`.
4. **Не добавлять частые фоновые опросы SDU**, которые могут спровоцировать инвалидацию `PHPSESSID`.
5. Все тесты в `test/` должны проходить: `npm test` (все 28+ тестов).
