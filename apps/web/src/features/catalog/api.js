import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';

export function useCatalogResource(path, params, options = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['catalog', user?.id, path, params],
    queryFn: async ({ signal }) => (await apiClient.get(path, { params, signal })).data,
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
    enabled: options.enabled,
  });
}

/** Catalog writes also refresh organization queries: portal accounts are users. */
export function useCatalogWrite() {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ method, path, body }) =>
      (await apiClient.request({ method, url: path, data: body })).data?.data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['catalog'] });
      void client.invalidateQueries({ queryKey: ['organization'] });
    },
  });
}

export function useClients(filters) {
  return useCatalogResource('/clients', filters, { keepPrevious: true });
}

export function useClient(id) {
  return useCatalogResource('/clients/' + id, undefined, { enabled: Boolean(id) });
}

/** Lists a client's products, stock items or portal accounts (`resource` = path segment). */
export function useClientList(id, resource, params) {
  return useCatalogResource('/clients/' + id + '/' + resource, params, { keepPrevious: true });
}
