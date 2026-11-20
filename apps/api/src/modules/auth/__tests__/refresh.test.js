import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { hashRefreshToken } from '../../../core/auth/index.js';
import { clock } from '../../../core/time/clock.js';
import { prisma } from '../../../db/client.js';
import { createAgency } from '../../../db/__tests__/factories.js';
import {
  bearer,
  createUserWithPassword,
  login,
  refreshCookie,
  refreshSetCookie,
} from '../../../../test/helpers/auth.js';
import { deleteExpiredRefreshTokens } from '../auth.repository.js';

const REFRESH = '/api/v1/auth/refresh';
const DAY_MS = 86_400_000;

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

const refreshWith = (cookie) => {
  const req = request(app).post(REFRESH);
  return cookie ? req.set('Cookie', cookie) : req;
};
const rawToken = (cookie) => cookie.slice('ff_rt='.length);

describe('POST /auth/refresh', () => {
  it('rotates the token: new access token + cookie, old token revoked and linked to the new one', async () => {
    const user = await createUserWithPassword(agency.id);
    const session = await login(app, user);

    const res = await refreshWith(session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      accessToken: expect.any(String),
      expiresIn: 900,
      user: { id: user.id, email: user.email },
    });
    const next = refreshCookie(res);
    expect(next).not.toBe(session.cookie);

    const old = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken(session.cookie)) },
    });
    const fresh = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(rawToken(next)) },
    });
    expect(old.revokedAt).toBeInstanceOf(Date);
    expect(old.replacedById).toBe(fresh.id);
    expect(fresh.familyId).toBe(old.familyId);
    expect(fresh.revokedAt).toBeNull();

    // The new access token works.
    const me = await request(app).get('/api/v1/auth/me').set(bearer(res.body.data.accessToken));
    expect(me.status).toBe(200);
    // The new refresh token works too.
    expect((await refreshWith(next)).status).toBe(200);
  });

  it('reusing a rotated token revokes the whole family, answers 401 REFRESH_TOKEN_REUSED and is audited', async () => {
    const user = await createUserWithPassword(agency.id);
    const session = await login(app, user);
    const rotated = refreshCookie(await refreshWith(session.cookie));

    const reuse = await refreshWith(session.cookie);

    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    // The cookie is cleared.
    expect(refreshSetCookie(reuse)).toMatch(/^ff_rt=;/);

    // The legitimate successor is dead too (revoked with its family, so simply expired).
    const after = await refreshWith(rotated);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SESSION_EXPIRED');

    const family = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(family.length).toBeGreaterThanOrEqual(2);
    for (const token of family) expect(token.revokedAt).toBeInstanceOf(Date);

    const audit = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'auth.refresh_reuse_detected' },
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]).toMatchObject({ actorType: 'system', agencyId: agency.id });
    expect(audit[0].after).toEqual({
      familyId: family[0].familyId,
      refreshTokenId: expect.any(String),
    });
  });

  it('reuse does not touch the other sessions (families) of the same user', async () => {
    const user = await createUserWithPassword(agency.id);
    const laptop = await login(app, user);
    const phone = await login(app, user);
    await refreshWith(laptop.cookie);
    await refreshWith(laptop.cookie); // reuse on the laptop family

    expect((await refreshWith(phone.cookie)).status).toBe(200);
  });

  it('an expired refresh token gets 401 SESSION_EXPIRED', async () => {
    const user = await createUserWithPassword(agency.id);
    const session = await login(app, user);

    vi.spyOn(clock, 'now').mockReturnValue(new Date(Date.now() + 7 * DAY_MS + 1_000));
    const res = await refreshWith(session.cookie);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it.each([
    ['no cookie', undefined],
    ['an unknown token', 'ff_rt=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['an empty cookie', 'ff_rt='],
  ])('%s gets 401 SESSION_EXPIRED', async (_label, cookie) => {
    const res = await refreshWith(cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('never reads a token from the body or a header', async () => {
    const user = await createUserWithPassword(agency.id);
    const session = await login(app, user);
    const token = rawToken(session.cookie);

    const inBody = await request(app).post(REFRESH).send({ refreshToken: token });
    expect(inBody.status).toBe(400);

    const inHeader = await request(app).post(REFRESH).set('Authorization', `Bearer ${token}`);
    expect(inHeader.status).toBe(401);
    expect(inHeader.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('FR-003 a suspended user cannot refresh', async () => {
    const user = await createUserWithPassword(agency.id);
    const session = await login(app, user);
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });

    const res = await refreshWith(session.cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });
});

describe('POST /auth/logout and /auth/logout-all', () => {
  it('logout revokes this browser’s refresh token and clears the cookie', async () => {
    const user = await createUserWithPassword(agency.id);
    const session = await login(app, user);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set(bearer(session.accessToken))
      .set('Cookie', session.cookie);

    expect(res.status).toBe(204);
    expect(refreshSetCookie(res)).toMatch(
      /^ff_rt=; Path=\/api\/v1\/auth; Expires=Thu, 01 Jan 1970/,
    );
    const after = await refreshWith(session.cookie);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('SESSION_EXPIRED'); // revoked by logout, not a reuse

    const audit = await prisma.auditLog.findMany({
      where: { entityId: user.id, action: 'auth.logout' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'user', actorId: user.id });
  });

  it('logout cannot revoke another user’s token', async () => {
    const alice = await createUserWithPassword(agency.id);
    const bob = await createUserWithPassword(agency.id);
    const aliceSession = await login(app, alice);
    const bobSession = await login(app, bob);

    await request(app)
      .post('/api/v1/auth/logout')
      .set(bearer(aliceSession.accessToken))
      .set('Cookie', bobSession.cookie);

    expect((await refreshWith(bobSession.cookie)).status).toBe(200);
  });

  it('logout-all ends every session: refresh tokens revoked and access tokens rejected', async () => {
    const user = await createUserWithPassword(agency.id);
    const first = await login(app, user);
    const second = await login(app, user);

    const res = await request(app).post('/api/v1/auth/logout-all').set(bearer(first.accessToken));
    expect(res.status).toBe(204);

    for (const session of [first, second]) {
      expect((await refreshWith(session.cookie)).status).toBe(401);
      const me = await request(app).get('/api/v1/auth/me').set(bearer(session.accessToken));
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe('SESSION_EXPIRED');
    }
  });

  it('logout requires an access token', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('deleteExpiredRefreshTokens', () => {
  it('deletes tokens expired before the cut-off, including rotated chains, and keeps live ones', async () => {
    const user = await createUserWithPassword(agency.id);
    const old = await login(app, user);
    await refreshWith(old.cookie); // old → rotated chain of 2 rows
    const live = await login(app, user);

    // Age the first family only.
    const oldFamily = (
      await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(rawToken(old.cookie)) },
      })
    ).familyId;
    await prisma.refreshToken.updateMany({
      where: { familyId: oldFamily },
      data: { expiresAt: new Date(Date.now() - DAY_MS) },
    });

    const deleted = await deleteExpiredRefreshTokens(new Date());

    expect(deleted).toBe(2);
    const remaining = await prisma.refreshToken.findMany({ where: { userId: user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tokenHash).toBe(hashRefreshToken(rawToken(live.cookie)));
  });
});
