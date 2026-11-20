import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { apiClient } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';

/**
 * Downloads a file with the session token (file URLs never carry credentials) and exposes it as an
 * object URL, revoked when no longer used. A 404 (missing, out of scope or not shared) is reported
 * as `NOT_FOUND`.
 * @param {string | undefined} id
 * @param {'thumbnail'} [variant]
 */
export function useFileObjectUrl(id, variant) {
  const { user } = useAuth();
  const path = '/files/' + id + (variant ? '/' + variant : '');
  const query = useQuery({
    queryKey: ['files', user?.id, path],
    enabled: Boolean(id),
    staleTime: 300_000,
    retry: false,
    queryFn: async ({ signal }) => {
      try {
        return (await apiClient.get(path, { responseType: 'blob', signal })).data;
      } catch (error) {
        if (error.status === 404) error.code = 'NOT_FOUND';
        throw error;
      }
    },
  });
  const url = useMemo(() => (query.data ? URL.createObjectURL(query.data) : null), [query.data]);
  useEffect(() => () => url && URL.revokeObjectURL(url), [url]);
  return { url, type: query.data?.type, error: query.error, pending: query.isPending };
}
