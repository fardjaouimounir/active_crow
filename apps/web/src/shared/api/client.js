import { INTERNAL_ERROR } from '@fieldflow/shared';
import axios from 'axios';

/** Client-side code for requests that never got an HTTP response (API down, offline, DNS…). */
export const NETWORK_ERROR = 'NETWORK_ERROR';

const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Every failed API call rejects with this shape, whatever went wrong. */
export class ApiError extends Error {
  /**
   * @param {{ code: string, message: string, details?: unknown, requestId?: string, status?: number }} fields
   */
  constructor({ code, message, details, requestId, status }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.status = status;
  }
}

/**
 * Normalises an Axios error into `{ code, message, details, requestId }` (+ HTTP `status`).
 * The request config is kept as a non-enumerable `config` so the auth interceptor can retry it.
 * @param {unknown} error
 * @returns {ApiError | unknown} cancellations are passed through untouched
 */
export function normalizeError(error) {
  if (error instanceof ApiError || axios.isCancel(error)) return error;
  const normalized = toApiError(error);
  Object.defineProperty(normalized, 'config', {
    value: /** @type {import('axios').AxiosError} */ (error)?.config,
    enumerable: false,
  });
  return normalized;
}

/** @param {unknown} error @returns {ApiError} */
function toApiError(error) {
  const response = /** @type {import('axios').AxiosError} */ (error)?.response;
  if (!response) {
    return new ApiError({
      code: NETWORK_ERROR,
      message: /** @type {Error} */ (error)?.message ?? 'Network error',
    });
  }

  const body = /** @type {any} */ (response.data)?.error;
  // A gateway error without our envelope comes from the proxy (Vite, Caddy): the API is unreachable.
  const unreachable = !body && GATEWAY_STATUSES.has(response.status);
  return new ApiError({
    code: body?.code ?? (unreachable ? NETWORK_ERROR : INTERNAL_ERROR),
    message: body?.message ?? `Request failed with status ${response.status}`,
    details: body?.details,
    requestId: body?.requestId ?? response.headers?.['x-request-id'],
    status: response.status,
  });
}

export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: { Accept: 'application/json' },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizeError(error)),
);
