import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';

const OPEN = ['queued', 'sent'];

/** The latest requests for one subject and capability, polled while one is still in flight. */
export function useAiRequests({ capability, subjectId, enabled = true }) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['ai', user?.id, 'requests', capability, subjectId],
    enabled: enabled && Boolean(subjectId),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get('/ai/requests', {
          signal,
          params: { capability, subjectId, pageSize: 1 },
        })
      ).data,
    refetchInterval: (query) => {
      const latest = query.state.data?.data?.[0];
      return latest && OPEN.includes(latest.status) ? 5000 : false;
    },
  });
}

export function useRequestSuggestion() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body) => (await apiClient.post('/ai/requests', body)).data.data,
    onSuccess: () => client.invalidateQueries({ queryKey: ['ai'] }),
  });
}

export function useAiList(path, params, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['ai', user?.id, path, params],
    enabled,
    queryFn: async ({ signal }) => (await apiClient.get(path, { params, signal })).data,
  });
}

export function useAiSuggestion(id) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['ai', user?.id, 'suggestion', id],
    queryFn: async ({ signal }) =>
      (await apiClient.get('/ai/suggestions/' + id, { signal })).data.data,
  });
}

export function useAiCommentary(capability, subjectId, period, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['ai', user?.id, 'commentary', capability, subjectId, period?.from, period?.to],
    enabled: enabled && Boolean(subjectId && period?.from && period?.to),
    queryFn: async ({ signal }) =>
      (
        await apiClient.get('/ai/commentary', {
          signal,
          params: { capability, subjectId, from: period.from, to: period.to },
        })
      ).data.data,
    staleTime: 60_000,
  });
}

export function useReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, decision, note }) =>
      (await apiClient.post(`/ai/suggestions/${id}/${decision}`, note ? { note } : {})).data.data,
    onSuccess: () => client.invalidateQueries({ queryKey: ['ai'] }),
  });
}
