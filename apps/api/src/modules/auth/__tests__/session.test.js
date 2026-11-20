import { ROLE_PERMISSIONS } from '@fieldflow/shared';
import express from 'express';
import { SignJWT } from 'jose';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { authenticate, revokeAllSessions, verifyPassword } from '../../../core/auth/index.js';
import { requirePermission } from '../../../core/authz/index.js';
import { errorHandler } from '../../../core/errors/index.js';
import { ok, requestId } from '../../../core/http/index.js';
import { clock } from '../../../core/time/clock.js';
import { prisma } from '../../../db/client.js';
import { withTransaction } from '../../../db/transaction.js';
import { createAgency } from '../../../db/__tests__/factories.js';
import {
  bearer,
  createUserWithPassword,
  login,
  refreshCookie,
} from '../../../../test/helpers/auth.js';

const ME = '/api/v1/auth/me';
const CHANGE = '/api/v1/auth/change-password';

let agency;
let app;
beforeAll(async () => {
  agency = await createAgency();
});
beforeEach(() => {
  app = createApp();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('authenticate', () => {
  it('GET /auth/me returns the user and the permissions of their role', async () => {
    const user = await createUserWithPassword(agency.id, { role: 'regional_manager' });
    const { accessToken } = await login(app, user);

    const res = await request(app).get(ME).set(bearer(accessToken));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: 'regional_manager',
        agencyId: agency.id,
        clientId: null,
        mustChangePassword: false,
      },
      permissions: [...ROLE_PERMISSIONS.regional_manager],
    });
  });

  it('a token_version bump makes an existing access token fail on the next request', async () => {
    const user = await createUserWithPassword(agency.id);
    const { accessToken } = await login(app, user);
    expect((await request(app).get(ME).set(bearer(accessToken))).status).toBe(200);

    await withTransaction((tx) => revokeAllSessions(tx, user.id));

    const res = await request(app).get(ME).set(bearer(accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('FR-003 a suspended user’s access token fails on the next request', async () => {
    const user = await createUserWithPassword(agency.id);
    const { accessToken } = await login(app, user);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });

    const res = await request(app).get(ME).set(bearer(accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('an expired access token gets 401 SESSION_EXPIRED', async () => {
    const user = await createUserWithPassword(agency.id);
    const { accessToken } = await login(app, user);

    vi.spyOn(clock, 'now').mockReturnValue(new Date(Date.now() + 16 * 60_000));
    const res = await request(app).get(ME).set(bearer(accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it.each([
    ['a malformed token', () => 'Bearer not-a-jwt'],
    ['another scheme', (token) => `Basic ${token}`],
    [
      'a token signed with another key',
      async (_token, user) =>
        `Bearer ${await new SignJWT({
          agencyId: user.agencyId,
          role: 'director',
          tv: 0,
          mcp: false,
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(user.id)
          .setIssuer('fieldflow-api')
          .setAudience('fieldflow')
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode('another-secret-another-secret-0000'))}`,
    ],
    [
      'an unsigned (alg: none) token',
      (_token, user) => {
        const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        return `Bearer ${part({ alg: 'none' })}.${part({ sub: user.id, agencyId: user.agencyId, role: 'director', tv: 0, mcp: false, iat: now, exp: now + 300, iss: 'fieldflow-api', aud: 'fieldflow' })}.`;
      },
    ],
    [
      'a tampered payload',
      (token) => {
        const [header, payload, signature] = token.split('.');
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
        const forged = Buffer.from(JSON.stringify({ ...claims, role: 'director' })).toString(
          'base64url',
        );
        return `Bearer ${header}.${forged}.${signature}`;
      },
    ],
  ])('%s gets 401 SESSION_EXPIRED', async (_label, makeHeader) => {
    const user = await createUserWithPassword(agency.id, { role: 'animateur' });
    const { accessToken } = await login(app, user);

    const res = await request(app)
      .get(ME)
      .set('Authorization', await makeHeader(accessToken, user));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('no Authorization header gets 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get(ME);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('role and status come from the database, not from the token', async () => {
    const user = await createUserWithPassword(agency.id, { role: 'supervisor' });
    const { accessToken } = await login(app, user);
    await prisma.user.update({ where: { id: user.id }, data: { role: 'animateur' } });

    const res = await request(app).get(ME).set(bearer(accessToken));
    expect(res.body.data.user.role).toBe('animateur');
    expect(res.body.data.permissions).toEqual([...ROLE_PERMISSIONS.animateur]);
  });
});

describe('requirePermission', () => {
  /** A probe route with the real middlewares, outside the production router. */
  function probeApp(...permissions) {
    const probe = express();
    probe.use(requestId);
    const router = express.Router();
    router.get('/probe', authenticate, requirePermission(...permissions), (req, res) =>
      ok(res, { actor: req.actor }),
    );
    probe.use('/api/v1', router);
    probe.use(errorHandler);
    return probe;
  }

  it('lets a role holding every permission through with a frozen req.actor', async () => {
    const user = await createUserWithPassword(agency.id, { role: 'director' });
    const { accessToken } = await login(app, user);

    const res = await request(probeApp('audit.read', 'campaign.manage'))
      .get('/api/v1/probe')
      .set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.actor).toEqual({
      type: 'user',
      id: user.id,
      agencyId: agency.id,
      role: 'director',
      clientId: null,
      mustChangePassword: false,
    });
  });

  it('answers 403 FORBIDDEN when one permission is missing', async () => {
    const user = await createUserWithPassword(agency.id, { role: 'general_manager' });
    const { accessToken } = await login(app, user);

    // general_manager holds campaign.read but not audit.read
    const res = await request(probeApp('campaign.read', 'audit.read'))
      .get('/api/v1/probe')
      .set(bearer(accessToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses unknown permission names at definition time', () => {
    expect(() => requirePermission('campaign.destroy')).toThrow(/Unknown permission/);
    expect(() => requirePermission()).toThrow(/at least one permission/);
  });
});

describe('FR-002 must-change-password gate', () => {
  it('blocks every other route with 403 PASSWORD_CHANGE_REQUIRED', async () => {
    const user = await createUserWithPassword(agency.id, { mustChangePassword: true });
    const { accessToken, res } = await login(app, user);
    expect(res.body.data.user.mustChangePassword).toBe(true);

    const blocked = await request(app).post('/api/v1/auth/logout-all').set(bearer(accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const me = await request(app).get(ME).set(bearer(accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.user.mustChangePassword).toBe(true);
  });

  it('allows logout while the change is pending', async () => {
    const user = await createUserWithPassword(agency.id, { mustChangePassword: true });
    const session = await login(app, user);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set(bearer(session.accessToken))
      .set('Cookie', session.cookie);
    expect(res.status).toBe(204);
  });

  it('after the change: gate lifted, new session returned, other sessions revoked, audited', async () => {
    const user = await createUserWithPassword(agency.id, { mustChangePassword: true });
    const other = await login(app, user);
    const current = await login(app, user);

    const res = await request(app)
      .post(CHANGE)
      .set(bearer(current.accessToken))
      .send({ currentPassword: user.password, newPassword: 'a-much-better-pass-7' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      expiresIn: 900,
      user: { id: user.id, mustChangePassword: false },
    });
    const newCookie = refreshCookie(res);
    const newToken = res.body.data.accessToken;

    // Gate lifted for the new session.
    expect(
      (await request(app).post('/api/v1/auth/logout-all').set(bearer(newToken))).status,
    ).not.toBe(403);

    // Old access tokens and refresh cookies (both sessions) are dead.
    for (const session of [other, current]) {
      expect((await request(app).get(ME).set(bearer(session.accessToken))).status).toBe(401);
      expect(
        (await request(app).post('/api/v1/auth/refresh').set('Cookie', session.cookie)).status,
      ).toBe(401);
    }
    expect(newCookie).toBeDefined();

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stored.mustChangePassword).toBe(false);
    expect(await verifyPassword(stored.passwordHash, 'a-much-better-pass-7')).toBe(true);

    const [audit] = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'auth.password_changed' },
    });
    expect(audit).toMatchObject({ actorType: 'user', actorId: user.id });
    expect(audit.before).toEqual({ mustChangePassword: true });
    const serialized = JSON.stringify({ before: audit.before, after: audit.after });
    expect(serialized).not.toMatch(/a-much-better-pass-7|argon2|passwordHash/);
  });

  it('a wrong current password gets 400 CURRENT_PASSWORD_INCORRECT and changes nothing', async () => {
    const user = await createUserWithPassword(agency.id, { mustChangePassword: true });
    const { accessToken } = await login(app, user);

    const res = await request(app)
      .post(CHANGE)
      .set(bearer(accessToken))
      .send({ currentPassword: 'not-my-password-1', newPassword: 'a-much-better-pass-7' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect((await request(app).get(ME).set(bearer(accessToken))).status).toBe(200);
  });

  it.each([
    ['too short', 'short1', ['min_length']],
    ['no digit', 'no-digits-at-all', ['digit']],
    ['no letter', '1234567890123', ['letter']],
  ])(
    'a weak new password (%s) gets 400 WEAK_PASSWORD listing the broken rules',
    async (_l, pwd, rules) => {
      const user = await createUserWithPassword(agency.id);
      const { accessToken } = await login(app, user);

      const res = await request(app)
        .post(CHANGE)
        .set(bearer(accessToken))
        .send({ currentPassword: user.password, newPassword: pwd });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('WEAK_PASSWORD');
      expect(res.body.error.details).toEqual(
        rules.map((rule) => ({ path: 'body.newPassword', message: rule })),
      );
    },
  );

  it('reusing the current password as the new one is refused', async () => {
    const user = await createUserWithPassword(agency.id, { mustChangePassword: true });
    const { accessToken } = await login(app, user);

    const res = await request(app)
      .post(CHANGE)
      .set(bearer(accessToken))
      .send({ currentPassword: user.password, newPassword: user.password });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('WEAK_PASSWORD');
    expect(res.body.error.details).toEqual([
      { path: 'body.newPassword', message: 'same_as_current' },
    ]);
  });

  it('rejects unknown body fields with 400 VALIDATION_FAILED', async () => {
    const user = await createUserWithPassword(agency.id);
    const { accessToken } = await login(app, user);

    const res = await request(app)
      .post(CHANGE)
      .set(bearer(accessToken))
      .send({ currentPassword: user.password, newPassword: 'a-much-better-pass-7', userId: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
