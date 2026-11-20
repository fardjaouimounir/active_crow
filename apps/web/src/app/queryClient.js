import { QueryClient } from '@tanstack/react-query';

const MAX_RETRIES = 1;

/**
 * Client errors (4xx) are final: retrying cannot fix them. Network failures and 5xx get one retry.
 * @param {number} failureCount
 * @param {unknown} error normalised ApiError from shared/api/client.js
 */
export function shouldRetry(failureCount, error) {
  const status = /** @type {{ status?: number }} */ (error)?.status;
  if (status && status >= 400 && status < 500) return false;
  return failureCount < MAX_RETRIES;
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
