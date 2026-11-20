import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';
import { useCampaignResource } from '../campaigns/api.js';

export const useBoard = (id, date) =>
  useCampaignResource(`/campaigns/${id}/attendance/board`, { date });
export const useProof = (id) =>
  useCampaignResource(`/attendance/${id}`, undefined, { enabled: Boolean(id) });
export const useReviewOverview = (enabled) =>
  useCampaignResource('/me/attendance/review', undefined, { enabled });
export const useVisits = (id, filters, enabled = true) =>
  useCampaignResource(`/campaigns/${id}/visits`, filters, { enabled });
export const useVisit = (id) =>
  useCampaignResource(`/visits/${id}`, undefined, { enabled: Boolean(id) });
export const useVisitOptions = (id) => useCampaignResource(`/campaigns/${id}/visits/options`);

export function useFieldWrite(idempotency) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, body, photos }) => {
      let data = body;
      if (photos) {
        data = new FormData();
        for (const [name, value] of Object.entries(body)) {
          if (value !== undefined)
            data.append(name, typeof value === 'string' ? value : JSON.stringify(value));
        }
        for (const photo of photos) data.append('photos', photo);
      }
      const options = idempotency ? { headers: { 'Idempotency-Key': idempotency.current() } } : {};
      return (await apiClient.post(path, data, options)).data.data;
    },
    onError: (error) => {
      if (error.status >= 400 && error.status < 500) idempotency?.rotate();
    },
    onSuccess: () => void client.invalidateQueries({ queryKey: ['campaigns'] }),
  });
}
