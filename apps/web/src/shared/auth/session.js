// Session lifecycle: bootstrap on page load, single-flight refresh, login/logout bookkeeping.
import { apiClient } from '../api/client.js';
import * as authApi from './authApi.js';
import { authStore } from './authStore.js';
import { installAuthInterceptors } from './interceptors.js';
import { tokenStore } from './tokenStore.js';

/** Name of the Web Lock that serialises refreshes across tabs of the same browser. */
const REFRESH_LOCK = 'fieldflow.auth.refresh';

/** @param {import('./authApi.js').SessionPayload} payload */
export function applySession({ accessToken, user }) {
  tokenStore.set(accessToken);
  authStore.setUser(user);
}

/**
 * Forgets the session locally (token and user).
 * @param {'logout' | 'expired'} [endedBy] 'logout' sends the user to a plain /login, 'expired' to /login?next=…
 */
export function clearSession(endedBy = 'expired') {
  tokenStore.clear();
  authStore.setAnonymous(endedBy);
}

async function rotate() {
  applySession(await authApi.refresh());
}

let inflight = null;

/**
 * Exchanges the refresh cookie for a new access token. Single-flight: concurrent callers (several
 * 401s at once, React StrictMode double effects) share one request, because a refresh token is
 * single-use and presenting it twice revokes the whole session. Other tabs wait on a Web Lock, so
 * they send the rotated cookie instead of the old one.
 * @returns {Promise<void>}
 */
export function refreshSession() {
  inflight ??= (
    globalThis.navigator?.locks ? navigator.locks.request(REFRESH_LOCK, rotate) : rotate()
  ).finally(() => {
    inflight = null;
  });
  return inflight;
}

let bootstrap = null;

/**
 * Once per page load: refresh (cookie → access token), then load the user with /auth/me.
 * Ends in `authenticated` or `anonymous`, never throws.
 * @returns {Promise<void>}
 */
export function bootstrapSession() {
  bootstrap ??= (async () => {
    try {
      await refreshSession();
      const { user } = await authApi.me();
      authStore.setUser(user);
    } catch {
      clearSession();
    }
  })();
  return bootstrap;
}

/** Ends the session on the server (best effort) and locally. */
export async function logout() {
  try {
    await authApi.logout();
  } finally {
    clearSession('logout');
  }
}

/** Test helper: back to a fresh page load. */
export function resetSessionForTests() {
  inflight = null;
  bootstrap = null;
  tokenStore.clear();
  authStore.reset();
}

installAuthInterceptors(apiClient, {
  getAccessToken: tokenStore.get,
  refresh: refreshSession,
  // The guards see `anonymous` and redirect to /login?next=…
  onSessionLost: clearSession,
});
