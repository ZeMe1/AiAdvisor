# Mandatory Onboarding & Architecture Rule

Before performing any action, writing code, or making edits, agents working on this repository **MUST strictly follow the mandates in [AI_rules.md](../../AI_rules.md)**:

1. **Mandatory Full Codebase Read**: Read the entire project, all `.md` files (`AI_rules.md`, `README.md`), all directories (`server/`, `src/sdu/`, `web/`, `test/`), and understand the whole architecture before touching any code.
2. **Dual Session Architecture Freeze**: DO NOT modify, refactor, or delete authentication, session management (`sessions` table, `zeme_session` cookie vs SDU `PHPSESSID`), or error handling.
3. **No False Logouts**: DO NOT call `handleAuthError` on secondary API failures (sections, electives, course search). DO NOT delete session cookies on upstream SDU session expiration.
4. **Offline-First & Caching Resilience**: Maintain local-first `localStorage` caching in `web/src/stores/scheduleStore.js` and Stale-While-Revalidate caching in `server/services/schedule.service.mjs`.
5. **English Only UI**: All UI elements, buttons, badges, errors, and toasts must strictly be in English.
6. **Pass All Tests**: Run `npm test` after changes and ensure all tests pass.
