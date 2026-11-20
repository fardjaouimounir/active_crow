import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { shouldRetry } from '../src/app/queryClient.js';
import { fetchHealth } from '../src/features/system/api.js';
import { ApiError, NETWORK_ERROR, apiClient, normalizeError } from '../src/shared/api/client.js';

/** @param {number} status @param {unknown} data */
function httpError(status, data) {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    data,
    headers: { 'x-request-id': 'header-id' },
    statusText: '',
    config: /** @type {any} */ ({ headers: {} }),
  });
}

describe('normalizeError', () => {
  it('keeps the API error envelope', () => {
    const error = normalizeError(
      httpError(422, {
        error: {
          code: 'BUSINESS_RULE_VIOLATION',
          message: 'No',
          details: { rule: 'BR-1' },
          requestId: 'r1',
        },
      }),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'BUSINESS_RULE_VIOLATION',
      message: 'No',
      details: { rule: 'BR-1' },
      requestId: 'r1',
      status: 422,
    });
  });

  it('maps a request with no response to NETWORK_ERROR', () => {
    expect(normalizeError(new AxiosError('Network Error', 'ERR_NETWORK'))).toMatchObject({
      code: NETWORK_ERROR,
      status: undefined,
    });
  });

  it('maps a proxy gateway error without envelope to NETWORK_ERROR', () => {
    expect(normalizeError(httpError(502, ''))).toMatchObject({ code: NETWORK_ERROR, status: 502 });
  });

  it('maps any other response without envelope to INTERNAL_ERROR', () => {
    expect(normalizeError(httpError(500, '<html>'))).toMatchObject({
      code: 'INTERNAL_ERROR',
      requestId: 'header-id',
    });
  });
});

describe('fetchHealth', () => {
  /** Answers every request with `status` / `data` through Axios' own status validation. */
  function stubAdapter(status, data) {
    return (config) =>
      new Promise((resolve, reject) => {
        const response = { status, data, headers: {}, statusText: '', config };
        if (config.validateStatus(status)) resolve(response);
        else reject(new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response));
      });
  }

  it('returns the degraded payload of a 503 instead of failing', async () => {
    const original = apiClient.defaults.adapter;
    const degraded = { status: 'degraded', db: 'down', version: '0.1.0', uptimeSeconds: 1 };
    apiClient.defaults.adapter = stubAdapter(503, { data: degraded });
    try {
      await expect(fetchHealth()).resolves.toEqual(degraded);
      apiClient.defaults.adapter = stubAdapter(500, '');
      await expect(fetchHealth()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    } finally {
      apiClient.defaults.adapter = original;
    }
  });
});

describe('query retry policy', () => {
  it('never retries 4xx and retries other failures once', () => {
    expect(shouldRetry(0, { status: 404 })).toBe(false);
    expect(shouldRetry(0, { status: 502 })).toBe(true);
    expect(shouldRetry(0, { status: undefined })).toBe(true);
    expect(shouldRetry(1, { status: undefined })).toBe(false);
  });
});
