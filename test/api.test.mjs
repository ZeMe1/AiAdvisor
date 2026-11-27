import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../server/index.mjs';

describe('API Integration & Validation Tests', () => {
  it('GET /api/me returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('GET /api/curriculum returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/curriculum');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('GET /api/eligibility returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/eligibility');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('GET /api/simulation returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/simulation');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('POST /api/simulation returns 401 when unauthenticated', async () => {
    const res = await request(app).post('/api/simulation').send({ targetEctsPerSemester: 12 });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('GET /api/admin/users returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('POST /api/auth/login fails with 400 on missing credentials (Zod validation)', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('username is required');
  });

  it('POST /api/auth/login fails with 400 on empty credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: '', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('username cannot be empty');
  });

  it('POST /api/auth/2fa fails with 400 on malformed code (Zod regex)', async () => {
    const res = await request(app).post('/api/auth/2fa').send({ code: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('exactly 6 digits');
  });

  it('GET / non-API path returns index.html', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('validateQuery handles req.query safely without Express 5 getter conflict', async () => {
    const express = (await import('express')).default;
    const { z } = await import('zod');
    const { validateQuery } = await import('../server/middlewares/validate.mjs');

    const testApp = express();
    testApp.get('/test-query', validateQuery(z.object({ code: z.string() })), (req, res) => {
      res.json({ code: req.query.code });
    });

    const res = await request(testApp).get('/test-query?code=CSS101');
    expect(res.status).toBe(200);
    expect(res.body.code).toBe('CSS101');
  });

  it('validateParams handles req.params safely without Express 5 getter conflict', async () => {
    const express = (await import('express')).default;
    const { z } = await import('zod');
    const { validateParams } = await import('../server/middlewares/validate.mjs');

    const testApp = express();
    testApp.get('/test-params/:id', validateParams(z.object({ id: z.string() })), (req, res) => {
      res.json({ id: req.params.id });
    });

    const res = await request(testApp).get('/test-params/42');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('42');
  });

  it('errorHandler preserves session cookie on sessionExpired error', async () => {
    const express = (await import('express')).default;
    const { errorHandler } = await import('../server/middlewares/error.middleware.mjs');

    const testApp = express();
    testApp.get('/test-session-expired', (req, res, next) => {
      const err = new Error('Сессия портала истекла — войдите заново');
      err.sessionExpired = true;
      next(err);
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get('/test-session-expired');
    expect(res.status).toBe(401);
    expect(res.body.sessionExpired).toBe(true);
    // set-cookie must NOT delete or reset the session cookie
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('scheduleService.getElectives falls back to candidate courses when upstream SDU fails', async () => {
    const { scheduleService } = await import('../server/services/schedule.service.mjs');
    const mockClient = {
      localUsername: 'testuser',
      getElectiveCourses: async () => {
        const err = new Error('Upstream SDU session expired');
        err.sessionExpired = true;
        throw err;
      },
    };

    const result = await scheduleService.getElectives(mockClient, {
      dk: 'XXX XXX',
      mufSqId: 8245,
      candidates: ['INF 362/INF 391/ CSS 375'],
    });

    expect(result.fromPortal).toBe(false);
    expect(result.courses).toEqual([
      { code: 'INF 362', name: '' },
      { code: 'INF 391', name: '' },
      { code: 'CSS 375', name: '' },
    ]);
  }, 15000);

  it('preserves PostgreSQL session across requests even after a SQL error or prerequisite/catalog lookup', async () => {
    const { initDb, pool } = await import('../server/db.mjs');
    const { curriculumRepository } = await import('../server/repositories/curriculum.repository.mjs');
    const { prerequisiteRepository } = await import('../server/repositories/prerequisite.repository.mjs');

    await initDb();
    const testUser = 'test_session_resilience_user';
    const testSessionId = 'test_session_resilience_token_64chars_00000000000000000000000000';

    try {
      const { rows: uRows } = await pool.query(
        `INSERT INTO users (username, display_name, role)
         VALUES ($1, 'Session Resilience User', 'Student')
         ON CONFLICT (username) DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING id, username`,
        [testUser]
      );
      await pool.query(
        `INSERT INTO sessions (id, user_id, username, role, status, expires_at)
         VALUES ($1, $2, $3, 'Student', 'authed', NOW() + INTERVAL '1 day')
         ON CONFLICT (id) DO NOTHING`,
        [testSessionId, uRows[0].id, testUser]
      );

      const cookie = `zeme_session=${testSessionId}`;

      // 1st authenticated request succeeds
      const firstRes = await request(app).get('/api/profile').set('Cookie', cookie);
      expect(firstRes.status).toBe(200);
      expect(firstRes.body.username).toBe(testUser);

      // Trigger catalog & prerequisite queries + an intentional invalid SQL query
      curriculumRepository.clearCatalogCache();
      prerequisiteRepository.clearCache();
      await curriculumRepository.getCatalogCourses();
      await prerequisiteRepository.getAllPrerequisites();
      await pool.query('SELECT nonexistent_column_xyz FROM users').catch(() => {});

      // 2nd and 3rd authenticated requests MUST still find the session in PostgreSQL (no switch to empty in-memory store!)
      const secondRes = await request(app).get('/api/profile').set('Cookie', cookie);
      expect(secondRes.status).toBe(200);
      expect(secondRes.body.username).toBe(testUser);

      const chatRes = await request(app).get('/api/chat/messages').set('Cookie', cookie);
      expect(chatRes.status).toBe(200);
      expect(Array.isArray(chatRes.body.messages)).toBe(true);
    } finally {
      await pool.query('DELETE FROM sessions WHERE id = $1', [testSessionId]).catch(() => {});
      await pool.query('DELETE FROM users WHERE username = $1', [testUser]).catch(() => {});
    }
  }, 20000);
});
