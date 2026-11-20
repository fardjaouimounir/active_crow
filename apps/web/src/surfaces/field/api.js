import { useQuery } from '@tanstack/react-query';
import { apiClient, NETWORK_ERROR } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';

export const FIELD_TIMEOUT = 20_000;
const report = (reachable) =>
  window.dispatchEvent(new CustomEvent('fieldflow:connection', { detail: reachable }));

export async function fieldRequest(options) {
  try {
    const response = await apiClient.request({ ...options, timeout: FIELD_TIMEOUT });
    report(true);
    return response.data;
  } catch (error) {
    if (!options.signal?.aborted) report(Boolean(error.status && error.code !== NETWORK_ERROR));
    throw error;
  }
}

export function useFieldQuery(url, params, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['field', user?.id, url, params],
    enabled: enabled && Boolean(user),
    queryFn: ({ signal }) => fieldRequest({ method: 'get', url, params, signal }),
    staleTime: 30_000,
    refetchOnWindowFocus: 'always',
    retry: false,
  });
}
