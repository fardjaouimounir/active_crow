import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '../../shared/auth/hooks.js';
import { apiClient } from '../../shared/api/client.js';

export function useOrganizationResource(path, params, options = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['organization', user?.id, path, params],
    queryFn: async ({ signal }) => (await apiClient.get(path, { params, signal })).data,
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
    enabled: options.enabled,
    staleTime: options.staleTime,
  });
}

export function useOrganizationWrite() {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ method, path, body }) =>
      (await apiClient.request({ method, url: path, data: body })).data?.data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['organization'] });
    },
  });
}

export function useWilayas() {
  return useOrganizationResource('/reference/wilayas', undefined, { staleTime: 86400000 });
}

export function useCommunes(wilaya) {
  return useOrganizationResource('/reference/wilayas/' + wilaya + '/communes', undefined, {
    enabled: Boolean(wilaya),
    staleTime: 86400000,
  });
}

export function useManagers(search, roles) {
  const { user } = useAuth();
  const results = useQueries({
    queries: roles.map((role) => ({
      queryKey: ['organization', user?.id, '/users', { q: search, role, status: 'active' }],
      queryFn: async ({ signal }) =>
        (await apiClient.get('/users', { signal, params: { q: search, role, status: 'active' } }))
          .data.data,
    })),
  });
  return {
    options: results.flatMap((result) =>
      (result.data ?? []).map(({ id, fullName }) => ({ value: id, label: fullName })),
    ),
    pending: results.some((result) => result.isPending),
    error: results.find((result) => result.error)?.error,
  };
}
