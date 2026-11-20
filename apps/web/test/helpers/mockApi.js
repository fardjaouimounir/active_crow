// Replaces the Axios adapter of the shared apiClient, so requests go through the real interceptors
// (Bearer header, silent refresh, error normalisation) but never leave the test.
import { AxiosError } from 'axios';
import { apiClient } from '../../src/shared/api/client.js';

/**
 * @typedef {(config: import('axios').InternalAxiosRequestConfig) => [number, unknown] | Promise<[number, unknown]>} Handler
 */

/**
 * @param {Record<string, Handler>} routes keyed by `METHOD /path`, e.g. `POST /auth/login`
 * @returns {{ calls: Array<{ key: string, authorization: string | undefined, body: unknown }>, count: (key: string) => number, restore: () => void }}
 */
export function mockApi(routes) {
  const calls = [];
  const original = apiClient.defaults.adapter;

  apiClient.defaults.adapter = async (config) => {
    const key = `${config.method.toUpperCase()} ${config.url}`;
    calls.push({
      key,
      authorization: config.headers.get('Authorization') ?? undefined,
      idempotencyKey: config.headers.get('Idempotency-Key') ?? undefined,
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
    });
    const handler = routes[key];
    const [status, data] = handler
      ? await handler(config)
      : [404, { error: { code: 'NOT_FOUND', message: `No stub for ${key}` } }];
    const response = { status, data, headers: {}, statusText: '', config, request: {} };
    if (config.validateStatus(status)) return response;
    throw new AxiosError(
      `Request failed with status ${status}`,
      'ERR_BAD_REQUEST',
      config,
      {},
      response,
    );
  };

  return {
    calls,
    count: (key) => calls.filter((call) => call.key === key).length,
    restore: () => {
      apiClient.defaults.adapter = original;
    },
  };
}

/** A handler that fails without any HTTP response (API down). */
export const networkError = (config) => {
  throw new AxiosError('Network Error', 'ERR_NETWORK', config);
};

/** @param {string} code @param {number} status */
export const apiError = (status, code) => [
  status,
  { error: { code, message: code, requestId: 'r-1' } },
];

export function sessionFor(user, accessToken = 'access-1') {
  return { data: { accessToken, expiresIn: 900, user } };
}

/** @param {Partial<import('../../src/shared/auth/authStore.js').SessionUser>} overrides */
export function makeUser(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Amina Benali',
    email: 'amina@agency.dz',
    role: 'director',
    agencyId: '22222222-2222-4222-8222-222222222222',
    clientId: null,
    mustChangePassword: false,
    ...overrides,
  };
}
