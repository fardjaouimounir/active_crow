import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';

const HEALTH_REFRESH_MS = 15_000;

export const systemKeys = {
  all: ['system'],
  health: () => [...systemKeys.all, 'health'],
};

/**
 * 503 means "API up, database down" and still carries the `{ data }` envelope, so it is a result,
 * not an error.
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ status: 'ok' | 'degraded', db: 'up' | 'down', version: string, uptimeSeconds: number }>}
 */
export async function fetchHealth({ signal } = {}) {
  const response = await apiClient.get('/health', {
    signal,
    validateStatus: (status) => status === 200 || status === 503,
  });
  return response.data.data;
}

export function useHealthQuery() {
  return useQuery({
    queryKey: systemKeys.health(),
    queryFn: fetchHealth,
    refetchInterval: HEALTH_REFRESH_MS,
  });
}
