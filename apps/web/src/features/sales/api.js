import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';
import { useCampaignResource } from '../campaigns/api.js';

export const useSales = (id, filters, enabled) =>
  useCampaignResource(`/campaigns/${id}/sales`, filters, { enabled });
export const useSale = (id) =>
  useCampaignResource('/sales/' + id, undefined, { enabled: Boolean(id) });
export const useSalesView = (id, suffix, enabled) =>
  useCampaignResource(`/campaigns/${id}/${suffix}`, undefined, { enabled });
export const useCustomer = (id) =>
  useCampaignResource('/customers/' + id, undefined, {
    enabled: Boolean(id),
    gcTime: 0,
    staleTime: 0,
  });
export const useEntries = (id, filters) =>
  useCampaignResource(`/tombolas/${id}/entries`, filters, { enabled: Boolean(id) });

export function useSaleMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ method = 'post', path, body }) =>
      (await apiClient[method](path, body)).data.data,
    onSuccess: () => void client.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}
