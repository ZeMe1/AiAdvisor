# Session Management & Auth Freeze Rule

Agents working on this repository MUST strictly follow the mandates in [AI_rules.md](../../AI_rules.md):
- DO NOT modify, refactor, or delete the authentication, session management, or two-tier caching architecture.
- DO NOT call `handleAuthError` on secondary API failures (sections, electives, course search).
- DO NOT delete user session cookies in `errorHandler` on upstream SDU expiration.
- Maintain the local-first `localStorage` caching in `web/src/stores/scheduleStore.js` and Stale-While-Revalidate caching in `server/services/schedule.service.mjs`.
