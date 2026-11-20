import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { hashEmail } from '../../../core/audit/index.js';
import { verifyAccessToken } from '../../../core/auth/index.js';
import { prisma } from '../../../db/client.js';
import { createAgency, createClient } from '../../../db/__tests__/factories.js';
import {
  DEFAULT_PASSWORD,
  createUserWithPassword,
  refreshCookie,
  refreshSetCookie,
} from '../../../../test/helpers/auth.js';

const LOGIN = '/api/v1/auth/login';

let agency;
let app;
beforeAll(async () => {
  agency = await createAgency();
});
beforeEach(() => {
  app = createApp();
});

describe('FR-001 POST /auth/login', () => {
  it('returns an access token and the public user, and sets the refresh cookie with strict flags', async () => {
    const user = await createUserWithPassword(agency.id, { role: 'supervisor' });

    const res = await request(app)
      .post(LOGIN)
      .send({ email: `  ${user.email.toUpperCase()} `, password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      accessToken: expect.any(String),
      expiresIn: 900,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: 'supervisor',
        agencyId: agency.id,
        clientId: null,
        mustChangePassword: false,
      },
    });
    expect(res.headers['cache-control']).toBe('no-store');

    const claims = await verifyAccessToken(res.body.data.accessToken);
    expect(claims).toMatchObject({
      sub: user.id,
      agencyId: agency.id,
      role: 'supervisor',
      tv: 0,
      mcp: false,
    });
    expect(claims.exp - claims.iat).toBe(900);
    expect(claims).not.toHaveProperty('clientId');

    const cookie = refreshSetCookie(res);
    expect(cookie).toMatch(/^ff_rt=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/; Path=\/api\/v1\/auth(;|$)/);
    expect(cookie).toMatch(/; HttpOnly(;|$)/);
    expect(cookie).toMatch(/; Secure(;|$)/); // NODE_ENV=test is not development
    expect(cookie).toMatch(/; SameSite=Strict(;|$)/);
    expect(cookie).toMatch(/; Expires=/);

    // Only the hash is stored, in a new family, with the client's ip and user agent.
    const raw = refreshCookie(res).slice('ff_rt='.length);
    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).not.toBe(raw);
    expect(tokens[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttlDays = (tokens[0].expiresAt - tokens[0].createdAt) / 86_400_000;
    expect(Math.round(ttlDays)).toBe(7);

    const after = await prisma.user.findUnique({ where: { id: user.id } });
    expect(after.lastLoginAt).toBeInstanceOf(Date);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'auth.login_succeeded' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'user', actorId: user.id, agencyId: agency.id });
    expect(audit[0].requestId).toBe(res.headers['x-request-id']);
  });

  it('includes clientId for client users', async () => {
    const client = await createClient(agency.id);
    const user = await createUserWithPassword(agency.id, { role: 'client', clientId: client.id });

    const res = await request(app).post(LOGIN).send({ email: user.email, password: user.password });

    expect(res.status).toBe(200);
    expect(res.body.data.user.clientId).toBe(client.id);
    expect(await verifyAccessToken(res.body.data.accessToken)).toMatchObject({
      clientId: client.id,
    });
  });

  it('wrong password, unknown email and suspended / left users get the identical 401 body', async () => {
    const active = await createUserWithPassword(agency.id);
    const suspended = await createUserWithPassword(agency.id, { status: 'suspended' });
    const left = await createUserWithPassword(agency.id, { status: 'left' });

    const attempts = [
      { email: active.email, password: 'wrong-password-1' },
      { email: 'nobody@nowhere.test', password: DEFAULT_PASSWORD },
      { email: suspended.email, password: DEFAULT_PASSWORD },
      { email: left.email, password: DEFAULT_PASSWORD },
    ];
    const bodies = [];
    for (const attempt of attempts) {
      const res = await request(app).post(LOGIN).send(attempt);
      expect(res.status).toBe(401);
      expect(refreshSetCookie(res)).toBeUndefined();
      const { requestId, ...error } = res.body.error;
      expect(requestId).toBe(res.headers['x-request-id']);
      bodies.push(error);
    }
    expect(bodies[0]).toEqual({
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('audits failures with an email hash, never the email or the password', async () => {
    const user = await createUserWithPassword(agency.id);
    await request(app).post(LOGIN).send({ email: user.email, password: 'wrong-password-1' });

    const [row] = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'auth.login_failed' },
    });
    expect(row).toMatchObject({ actorType: 'system', actorId: null, agencyId: agency.id });
    expect(row.after).toEqual({ emailHash: hashEmail(user.email), reason: 'wrong_password' });
    const serialized = JSON.stringify({ ...row, id: String(row.id) });
    expect(serialized).not.toContain(user.email);
    expect(serialized).not.toContain('wrong-password-1');
  });

  it('records the account state as the failure reason for suspended users (internal audit only)', async () => {
    const user = await createUserWithPassword(agency.id, { status: 'suspended' });
    await request(app).post(LOGIN).send({ email: user.email, password: user.password });

    const [row] = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'auth.login_failed' },
    });
    expect(row.after.reason).toBe('account_suspended');
  });

  it('rejects malformed bodies with 400 VALIDATION_FAILED', async () => {
    const res = await request(app)
      .post(LOGIN)
      .send({ email: 'not-an-email', password: '', agencyId: agency.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d) => d.path)).toEqual(
      expect.arrayContaining(['body.email', 'body.password']),
    );
  });

  it('allows 5 attempts per minute per IP + email; the 6th gets 429 RATE_LIMITED', async () => {
    const user = await createUserWithPassword(agency.id);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const res = await request(app)
        .post(LOGIN)
        .send({ email: user.email, password: `wrong-password-${attempt}` });
      expect(res.status).toBe(401);
    }

    // Same email in another case: same key.
    const sixth = await request(app)
      .post(LOGIN)
      .send({ email: user.email.toUpperCase(), password: user.password });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');

    // Another email from the same IP is counted separately.
    const other = await createUserWithPassword(agency.id);
    const res = await request(app)
      .post(LOGIN)
      .send({ email: other.email, password: other.password });
    expect(res.status).toBe(200);
  });
});
