// Session state outside React, so the Axios interceptors and the UI share one source of truth.
// Components read it through useAuth() (useSyncExternalStore).

/**
 * @typedef {object} SessionUser
 * @property {string} id
 * @property {string} fullName
 * @property {string} email
 * @property {import('@fieldflow/shared').USER_ROLES[number]} role
 * @property {string} agencyId
 * @property {string | null} clientId
 * @property {boolean} mustChangePassword
 */

/**
 * @typedef {object} AuthState
 * @property {'loading' | 'authenticated' | 'anonymous'} status
 * @property {SessionUser | null} user
 * @property {'logout' | 'expired'} [endedBy] why an anonymous session ended (after a session existed)
 */

const INITIAL = Object.freeze({ status: 'loading', user: null });

/** @type {AuthState} */
let state = INITIAL;
const listeners = new Set();

function setState(next) {
  state = Object.freeze(next);
  for (const listener of listeners) listener();
}

export const authStore = Object.freeze({
  /** @param {() => void} listener */
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** @returns {AuthState} */
  getSnapshot: () => state,
  /** @param {SessionUser} user */
  setUser(user) {
    setState({ status: 'authenticated', user });
  },
  /** @param {'logout' | 'expired'} [endedBy] */
  setAnonymous(endedBy = 'expired') {
    setState({ status: 'anonymous', user: null, endedBy });
  },
  /** Back to the initial "loading" state (tests). */
  reset() {
    setState(INITIAL);
  },
});
