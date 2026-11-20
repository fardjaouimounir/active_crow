import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClient } from '../../shared/api/client.js';
import { useCampaignResource } from '../campaigns/api.js';

const base = (id) => '/campaigns/' + id + '/stock';
export const useBalances = (id) => useCampaignResource(base(id) + '/balances');
export const useMovements = (id, filters) =>
  useCampaignResource(base(id) + '/movements', filters, { keepPrevious: true });
export const useMovement = (id) =>
  useCampaignResource('/stock/movements/' + id, undefined, { enabled: Boolean(id) });
export const useReconciliation = (id, enabled = true) =>
  useCampaignResource(base(id) + '/reconciliation', undefined, { enabled });
export const useRecipients = (id, direction) =>
  useCampaignResource(base(id) + '/recipients', { direction });
export const useMyStock = (enabled = true) =>
  useCampaignResource('/me/stock', undefined, { enabled });

/**
 * One Idempotency-Key per opened form: a double click or a retry reuses it. After an answer from
 * the server (a 4xx, not a network or server failure) the key is replaced, so a corrected form is a new request.
 */
export function useIdempotencyKey() {
  const key = useRef(crypto.randomUUID());
  return { current: () => key.current, rotate: () => (key.current = crypto.randomUUID()) };
}

/** A stock write (JSON or multipart) carrying the form's Idempotency-Key. */
export function useStockWrite(idempotency) {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ path, body, file }) => {
      let data = body;
      if (file) {
        data = new FormData();
        for (const [name, value] of Object.entries(body)) {
          if (value === undefined || value === null) continue;
          data.append(name, typeof value === 'string' ? value : JSON.stringify(value));
        }
        data.append('file', file);
      }
      return (
        await apiClient.post(path, data, { headers: { 'Idempotency-Key': idempotency.current() } })
      ).data.data;
    },
    onError: (error) => {
      if (error.status && error.status < 500) idempotency.rotate();
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}
