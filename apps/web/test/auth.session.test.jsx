import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { apiClient } from '../src/shared/api/client.js';
import { authStore } from '../src/shared/auth/authStore.js';
import { useCan } from '../src/shared/auth/hooks.js';
import { applySession, resetSessionForTests } from '../src/shared/auth/session.js';
import { safeNextPath } from '../src/shared/auth/surfaces.js';
import { tokenStore } from '../src/shared/auth/tokenStore.js';
import { apiError, makeUser, mockApi, sessionFor } from './helpers/mockApi.js';

let api;
afterEach(() => {
  api?.restore();
  resetSessionForTests();
});

/** /things answers 401 unless called with the token `access-2`. */
const thingsRequiringNewToken = (config) =>
  config.headers.get('Authorization') === 'Bearer access-2'
    ? [200, { data: 'ok' }]
    : apiError(401, 'SESSION_EXPIRED');

describe('silent refresh', () => {
  it('is single-flight: two concurrent 401s wait for one refresh, then both retry once', async () => {
    applySession(sessionFor(makeUser(), 'access-1').data);
    let resolveRefresh;
    api = mockApi({
      'GET /things': thingsRequiringNewToken,
      'GET /others': thingsRequiringNewToken,
      'POST /auth/refresh': () =>
        new Promise((resolve) => {
          resolveRefresh = () => resolve([200, sessionFor(makeUser(), 'access-2')]);
        }),
    });

    const both = Promise.all([apiClient.get('/things'), apiClient.get('/others')]);
    await expect.poll(() => api.count('POST /auth/refresh')).toBe(1);
    resolveRefresh();
    const [things, others] = await both;

    expect(things.data.data).toBe('ok');
    expect(others.data.data).toBe('ok');
    expect(api.count('POST /auth/refresh')).toBe(1);
    expect(api.count('GET /things')).toBe(2);
    expect(api.count('GET /others')).toBe(2);
    expect(tokenStore.get()).toBe('access-2');
  });

  it('never loops: a failed refresh logs out and the original 401 is returned', async () => {
    applySession(sessionFor(makeUser(), 'access-1').data);
    api = mockApi({
      'GET /things': thingsRequiringNewToken,
      'POST /auth/refresh': () => apiError(401, 'REFRESH_TOKEN_REUSED'),
    });

    await expect(apiClient.get('/things')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
    });
    expect(api.count('POST /auth/refresh')).toBe(1);
    expect(api.count('GET /things')).toBe(1);
    expect(tokenStore.get()).toBeNull();
    expect(authStore.getSnapshot().status).toBe('anonymous');
  });

  it('retries only once when the retried request still gets 401', async () => {
    applySession(sessionFor(makeUser(), 'access-1').data);
    api = mockApi({
      'GET /things': () => apiError(401, 'SESSION_EXPIRED'),
      'POST /auth/refresh': () => [200, sessionFor(makeUser(), 'access-2')],
    });

    await expect(apiClient.get('/things')).rejects.toMatchObject({ status: 401 });
    expect(api.count('GET /things')).toBe(2);
    expect(api.count('POST /auth/refresh')).toBe(1);
  });

  it('does not refresh on other errors (403, 404, 500)', async () => {
    applySession(sessionFor(makeUser(), 'access-1').data);
    api = mockApi({ 'GET /things': () => apiError(403, 'FORBIDDEN') });

    await expect(apiClient.get('/things')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(api.count('POST /auth/refresh')).toBe(0);
  });
});

describe('useCan', () => {
  function AuditLink() {
    return useCan('audit.read') ? <a href="/app/audit">Audit log</a> : null;
  }

  it('shows an element only to roles holding the permission', () => {
    applySession(sessionFor(makeUser({ role: 'director' })).data);
    const { rerender } = render(<AuditLink />);
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();

    applySession(sessionFor(makeUser({ role: 'supervisor' })).data);
    rerender(<AuditLink />);
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  });

  it('hides everything when nobody is signed in', () => {
    render(<AuditLink />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});

describe('safeNextPath', () => {
  it.each([
    ['/app', '/app'],
    ['/app/campaigns?page=2#top', '/app/campaigns?page=2#top'],
    ['//evil.example', null],
    ['/\\evil.example', null],
    ['https://evil.example/app', null],
    ['javascript:alert(1)', null],
    ['app', null],
    ['/app\n/x', null],
    ['', null],
    [null, null],
  ])('%j → %j', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
