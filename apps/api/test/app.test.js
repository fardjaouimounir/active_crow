import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { errorHandler, notFoundHandler } from '../src/core/errors/index.js';
import { ok, requestId, validate } from '../src/core/http/index.js';
import { createPrismaClient, pingDatabase } from '../src/db/client.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Minimal app using the real middlewares, with routes that exist only in this test file. */
function createTestApp(mount) {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  const router = express.Router();
  mount(router);
  app.use('/test', router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

describe('GET /api/v1/health', () => {
  it('returns 200 with the success envelope and db: up against the test database', async () => {
    const res = await request(createApp()).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: {
        status: 'ok',
        db: 'up',
        version: expect.any(String),
        uptimeSeconds: expect.any(Number),
      },
    });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('returns 503 with db: down when the database URL is unreachable', async () => {
    const unreachable = createPrismaClient({
      url: 'postgresql://nobody:nothing@127.0.0.1:1/none',
      pool: { max: 1, connectionTimeoutMillis: 1_000 },
    });
    try {
      const app = createApp({ checkDatabase: () => pingDatabase(unreachable) });
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(503);
      expect(res.body.data).toMatchObject({ status: 'degraded', db: 'down' });
    } finally {
      await unreachable.$disconnect();
    }
  });
});

describe('request id', () => {
  it('echoes a valid incoming X-Request-Id', async () => {
    const id = '3f2b8c1e-7d4a-4b9e-8c2f-1a2b3c4d5e6f';
    const res = await request(createApp()).get('/api/v1/health').set('X-Request-Id', id);

    expect(res.headers['x-request-id']).toBe(id);
  });

  it('replaces an X-Request-Id that is not a UUID', async () => {
    const res = await request(createApp())
      .get('/api/v1/health')
      .set('X-Request-Id', 'not-a-uuid" forged=1');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('unknown routes', () => {
  it('returns 404 in the error format with the request id', async () => {
    const res = await request(createApp()).post('/api/v1/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        requestId: res.headers['x-request-id'],
      },
    });
    expect(res.body.error.requestId).toMatch(UUID);
  });
});

describe('malformed JSON', () => {
  it('returns 400 VALIDATION_FAILED', async () => {
    const res = await request(createApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{"broken":');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('validate middleware', () => {
  const app = createTestApp((router) => {
    router.post(
      '/items/:id',
      validate({
        params: z.object({ id: z.uuid() }),
        query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
        body: z.object({ name: z.string().min(1), quantity: z.number().int().positive() }).strict(),
      }),
      (req, res) => ok(res, { params: req.params, query: req.query, body: req.body }),
    );
  });

  it('returns 400 VALIDATION_FAILED with the Zod issues in details', async () => {
    const res = await request(app)
      .post('/test/items/not-a-uuid?page=0')
      .send({ name: '', quantity: -1, extra: true });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.requestId).toMatch(UUID);
    const paths = res.body.error.details.map((d) => d.path);
    expect(paths).toEqual(
      expect.arrayContaining(['params.id', 'query.page', 'body.name', 'body.quantity']),
    );
    for (const detail of res.body.error.details) {
      expect(detail).toEqual({ path: expect.any(String), message: expect.any(String) });
    }
  });

  it('replaces params, query and body with the parsed values', async () => {
    const id = '3f2b8c1e-7d4a-4b9e-8c2f-1a2b3c4d5e6f';
    const res = await request(app)
      .post(`/test/items/${id}?page=3`)
      .send({ name: 'Mug', quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      params: { id },
      query: { page: 3 },
      body: { name: 'Mug', quantity: 2 },
    });
  });
});

describe('unexpected errors', () => {
  const app = createTestApp((router) => {
    router.get('/boom', () => {
      throw new Error('database password is hunter2');
    });
    router.get('/async-boom', async () => {
      throw new Error('async internal detail');
    });
  });

  it.each(['/test/boom', '/test/async-boom'])(
    '%s returns 500 with a generic message and no stack',
    async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          requestId: expect.stringMatching(UUID),
        },
      });
      expect(res.text).not.toMatch(/hunter2|async internal detail|at .*\.js/);
    },
  );
});

describe('proxy and API documentation configuration', () => {
  const settings = {
    DATABASE_URL: 'postgresql://local:local@localhost/test',
    JWT_ACCESS_SECRET: 'test-secret-of-at-least-32-characters',
  };

  it.each([
    [undefined, false],
    ['false', false],
    ['0', 0],
    ['1', 1],
    ['2', 2],
  ])('validates TRUST_PROXY=%s as %s', (value, expected) => {
    expect(parseEnv({ ...settings, TRUST_PROXY: value })).toMatchObject({
      success: true,
      data: { TRUST_PROXY: expected },
    });
  });

  it.each(['true', '-1', '1.5', 'loopback', '', '9999999999999999999'])(
    'rejects TRUST_PROXY=%s',
    (value) => {
      expect(parseEnv({ ...settings, TRUST_PROXY: value })).toMatchObject({ success: false });
    },
  );

  it('uses the forwarded client IP for the login limit behind one trusted hop', async () => {
    const app = createApp().set('trust proxy', 1);
    const login = (ip) =>
      request(app).post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email: 'invalid' });
    for (let index = 0; index < 5; index++) expect((await login('192.0.2.1')).status).toBe(400);
    expect((await login('192.0.2.1')).status).toBe(429);
    expect((await login('192.0.2.2')).status).toBe(400);
  });

  it.each(['/api/docs', '/api/docs/openapi.json'])(
    'does not serve %s outside development',
    async (path) => {
      expect((await request(createApp()).get(path)).status).toBe(404);
    },
  );
});
