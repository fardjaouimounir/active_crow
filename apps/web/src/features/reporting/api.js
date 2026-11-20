import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';

export const reportParams = (filters) =>
  Object.fromEntries(
    Object.entries(filters).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(',') : value,
    ]),
  );

export function useReport(path, filters = {}, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['reports', user?.id, path, filters],
    queryFn: async ({ signal }) =>
      (await apiClient.get('/reports' + path, { signal, params: reportParams(filters) })).data.data,
    enabled,
    staleTime: 30_000,
  });
}

export function useReportExport(language) {
  return useMutation({
    mutationFn: async ({ id, filters }) => {
      const path = id ? `/reports/campaigns/${id}/export.xlsx` : '/reports/export.xlsx';
      const response = await apiClient.get(path, {
        responseType: 'arraybuffer',
        transformResponse: [
          (body, headers) =>
            headers['content-type']?.includes('application/json')
              ? JSON.parse(new TextDecoder().decode(body))
              : body,
        ],
        params: id ? undefined : reportParams({ ...filters, view: 'dashboard' }),
        headers: { 'Accept-Language': language },
      });
      const url = URL.createObjectURL(
        new Blob([response.data], { type: response.headers['content-type'] }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = id ? 'fieldflow-campaign.xlsx' : 'fieldflow-dashboard.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}
