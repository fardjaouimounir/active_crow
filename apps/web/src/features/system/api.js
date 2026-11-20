import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';

const HEALTH_REFRESH_MS = 15_000;

export const systemKeys = {
  all: ['system'],
  health: () => [...systemKeys.all, 'health'],
};

/**
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ status: 'ok', version: string, uptimeSeconds: number }>}
 */
export async function fetchHealth({ signal } = {}) {
  const response = await apiClient.get('/health', { signal });
  return response.data.data;
}

export function useHealthQuery() {
  return useQuery({
    queryKey: systemKeys.health(),
    queryFn: fetchHealth,
    refetchInterval: HEALTH_REFRESH_MS,
  });
}
