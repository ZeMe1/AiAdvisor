# Mandatory Onboarding & Absolute Session Management Freeze

Before performing any action, writing code, or making edits, agents working on this repository **MUST strictly follow the mandates in [AI_rules.md](../../AI_rules.md)**:

1. **Mandatory Full Codebase Read**: Read the entire project, all `.md` files (`AI_rules.md`, `README.md`), all directories (`server/`, `src/sdu/`, `web/`, `test/`), and understand the whole architecture before touching any code.
2. **ABSOLUTE HANDS-OFF ON SESSION MANAGEMENT (LOCAL, TESTS, OR PROD — NO EXCEPTIONS)**:
   - **NEVER** modify, refactor, mock-wrap, or touch ANY file or logic related to session management or authentication: `server/middlewares/session.middleware.mjs`, `server/middlewares/auth.middleware.mjs`, `server/middlewares/error.middleware.mjs`, `server/controllers/auth.controller.mjs`, `server/routes/auth.routes.mjs`, `server/services/auth.service.mjs`, `server/repositories/session.repository.mjs`, `web/src/stores/authStore.js`, `web/src/App.jsx` (auth gate).
   - **NEVER** alter `pool.query` / `realPool` behavior in `server/db.mjs` to switch `useInMemory = true` on runtime SQL/network errors when PostgreSQL is configured, and **NEVER** delete existing table definitions from `initDb()` (even to make local tests pass without `.env.cloud` or PostgreSQL!). Doing so wipes active PostgreSQL sessions on Vercel and causes `401 not authenticated` across production.
   - New features may ONLY read `req.client.localUsername`, `req.client.localRole`, and `req.session.username` via existing `requireAuth` / `requireAdmin` middlewares, and may ONLY append `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for brand-new sprint tables at the bottom of `initDb()`.
3. **No False Logouts**: DO NOT call `handleAuthError` on secondary API failures (sections, electives, course search, chat, recommendations, simulation, admin). DO NOT delete session cookies on upstream SDU session expiration.
4. **Offline-First & Caching Resilience**: Maintain local-first `localStorage` caching in `web/src/stores/scheduleStore.js` and Stale-While-Revalidate caching in `server/services/schedule.service.mjs`.
5. **English Only UI**: All UI elements, buttons, badges, errors, and toasts must strictly be in English.
6. **Pass All Tests**: Run `npm test` after changes and ensure all tests pass.
