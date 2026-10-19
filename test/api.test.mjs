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

  it('GET /api/admin/users returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('not authenticated');
  });

  it('POST /api/auth/login fails with 400 on missing credentials (Zod validation)', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('username обязателен');
  });

  it('POST /api/auth/login fails with 400 on empty credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: '', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('username не может быть пустым');
  });

  it('POST /api/auth/2fa fails with 400 on malformed code (Zod regex)', async () => {
    const res = await request(app).post('/api/auth/2fa').send({ code: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ровно из 6 цифр');
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
});
