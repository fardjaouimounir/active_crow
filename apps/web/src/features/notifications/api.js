import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';

export function useCommunication(path, params, options = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['communication', user?.id, path, params],
    queryFn: async ({ signal }) => (await apiClient.get(path, { params, signal })).data,
    ...options,
  });
}
export function useCommunicationWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, body }) => (await apiClient.post(path, body)).data,
    onSuccess: () => client.invalidateQueries({ queryKey: ['communication'] }),
  });
}
