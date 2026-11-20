import packageJson from '../../package.json' with { type: 'json' };

export const APP_VERSION = packageJson.version;

export const API_PREFIX = '/api/v1';
export const JSON_BODY_LIMIT = '1mb';
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 300;
export const SHUTDOWN_TIMEOUT_MS = 10_000;
