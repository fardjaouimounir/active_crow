import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { shouldRetry } from '../src/app/queryClient.js';
import { ApiError, NETWORK_ERROR, normalizeError } from '../src/shared/api/client.js';

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

describe('query retry policy', () => {
  it('never retries 4xx and retries other failures once', () => {
    expect(shouldRetry(0, { status: 404 })).toBe(false);
    expect(shouldRetry(0, { status: 502 })).toBe(true);
    expect(shouldRetry(0, { status: undefined })).toBe(true);
    expect(shouldRetry(1, { status: undefined })).toBe(false);
  });
});
