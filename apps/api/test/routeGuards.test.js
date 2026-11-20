import { readFileSync } from 'node:fs';
// Deny by default: every route under /api/v1 must be either explicitly public (and on the list
// below) or go through `authenticate` and then a permission guard. The test walks the real Express
// router stack and reads the markers that the guard middlewares carry.
import express, { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { authenticate } from '../src/core/auth/index.js';
import { GUARD, guardOf, publicRoute, requirePermission } from '../src/core/authz/index.js';
import { openApiDocument } from '../src/openapi.js';
import { createRoutes } from '../src/routes.js';

const API_PREFIX = '/api/v1';
const PUBLIC_ROUTES = [
  'GET /api/v1/health',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
];

const joinPath = (prefix, path) =>
  `${prefix}/${path ?? ''}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');

/**
 * Every route of an app with the guards that run before its handler, in order (router-level
 * `use()` guards included).
 * @param {import('express').Express} app
 * @returns {Array<{ route: string, guards: string[] }>}
 */
export function listRoutes(app) {
  const routes = [];
  const walk = (stack, prefix, inherited) => {
    let active = inherited;
    for (const layer of stack) {
      if (layer.route) {
        const path = joinPath(prefix, layer.route.path);
        const guards = [...active, ...layer.route.stack.map((l) => guardOf(l.handle))].filter(
          Boolean,
        );
        for (const method of Object.keys(layer.route.methods)) {
          routes.push({ route: `${method.toUpperCase()} ${path}`, guards });
        }
      } else if (Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack, joinPath(prefix, layer.rawPath), active);
      } else if (guardOf(layer.handle)) {
        active = [...active, guardOf(layer.handle)];
      }
    }
  };
  walk(app.router.stack, '', []);
  return routes;
}

/** @returns {string[]} one message per route that breaks the rule */
export function findUnguardedRoutes(app) {
  const problems = [];
  for (const { route, guards } of listRoutes(app)) {
    const path = route.split(' ')[1];
    if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) continue;

    if (guards.includes(GUARD.PUBLIC)) {
      if (!PUBLIC_ROUTES.includes(route)) problems.push(`${route} is public but not on the list`);
      continue;
    }
    const auth = guards.indexOf(GUARD.AUTHENTICATE);
    const permission = guards.findIndex(
      (guard) =>
        guard === GUARD.PERMISSION ||
        guard === GUARD.ANY_AUTHENTICATED ||
        guard === GUARD.FILE_POLICY,
    );
    if (guards.includes(GUARD.SERVICE)) {
      if (guards.includes(GUARD.AUTHENTICATE))
        problems.push(`${route} mixes service and user auth`);
      continue;
    }
    if (auth === -1) problems.push(`${route} does not authenticate`);
    else if (permission === -1) problems.push(`${route} has no permission guard`);
    else if (permission < auth) problems.push(`${route} checks permissions before authenticate`);
  }
  return problems;
}

describe('route guards (FR-004 deny by default)', () => {
  it('every /api/v1 route of the real app is public-listed or authenticate + permission', () => {
    const app = createApp();
    const routes = listRoutes(app).map((r) => r.route);

    // The walker really sees the routes (not a vacuous pass).
    expect(routes).toEqual(
      expect.arrayContaining([
        ...PUBLIC_ROUTES,
        'POST /api/v1/auth/logout',
        'POST /api/v1/auth/logout-all',
        'POST /api/v1/auth/change-password',
        'GET /api/v1/auth/me',
      ]),
    );
    expect(findUnguardedRoutes(app)).toEqual([]);
  });

  it('fails when an unprotected route is added', () => {
    const app = express();
    app.use(createRoutes({ checkDatabase: async () => true }));
    const extra = Router();
    extra.get('/unprotected', (_req, res) => res.end());
    extra.get('/auth-only', authenticate, (_req, res) => res.end());
    extra.get('/wrong-order', requirePermission('audit.read'), authenticate, (_req, res) =>
      res.end(),
    );
    extra.get('/sneaky-public', publicRoute(), (_req, res) => res.end());
    extra.get('/ok', authenticate, requirePermission('audit.read'), (_req, res) => res.end());
    app.use(API_PREFIX, extra);

    expect(findUnguardedRoutes(app)).toEqual([
      'GET /api/v1/unprotected does not authenticate',
      'GET /api/v1/auth-only has no permission guard',
      'GET /api/v1/wrong-order checks permissions before authenticate',
      'GET /api/v1/sneaky-public is public but not on the list',
    ]);
  });

  it('counts router-level guards for the routes registered after them', () => {
    const app = express();
    const router = Router();
    router.get('/before', (_req, res) => res.end());
    router.use(authenticate, requirePermission('campaign.read'));
    router.get('/after', (_req, res) => res.end());
    app.use(`${API_PREFIX}/things`, router);

    expect(findUnguardedRoutes(app)).toEqual(['GET /api/v1/things/before does not authenticate']);
  });
});

it('documents every API route and keeps the generated document in sync', () => {
  const document = openApiDocument();
  const documented = Object.entries(document.paths).flatMap(([path, operations]) =>
    Object.keys(operations).map((method) => method.toUpperCase() + ' ' + path),
  );
  const registered = listRoutes(createApp())
    .map(({ route }) => route)
    .filter((route) => route.split(' ')[1].startsWith(API_PREFIX + '/'))
    .map((route) => route.replace(/:([A-Za-z_][\w]*)/g, '{$1}'));
  expect(documented.sort()).toEqual(registered.sort());
  expect(JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'))).toEqual(
    JSON.parse(JSON.stringify(document)),
  );
});
