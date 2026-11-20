/** Audit actions written by the auth module. */
export const AUTH_ACTIONS = Object.freeze({
  LOGIN_SUCCEEDED: 'auth.login_succeeded',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
  PASSWORD_CHANGED: 'auth.password_changed',
  REFRESH_REUSE_DETECTED: 'auth.refresh_reuse_detected',
  DIRECTOR_BOOTSTRAPPED: 'auth.director_bootstrapped',
});
