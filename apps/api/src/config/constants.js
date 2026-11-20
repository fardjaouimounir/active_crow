import packageJson from '../../package.json' with { type: 'json' };

export const APP_VERSION = packageJson.version;

export const API_PREFIX = '/api/v1';
export const JSON_BODY_LIMIT = '1mb';
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 300;
export const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Refresh-token cookie: only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_NAME = 'ff_rt';
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;
export const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
export const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5;
export const CHANGE_PASSWORD_RATE_LIMIT_MAX_ATTEMPTS = 5;
/** Business dates (YYYY-MM-DD) are expressed in this time zone. */
export const BUSINESS_TIME_ZONE = 'Africa/Algiers';
