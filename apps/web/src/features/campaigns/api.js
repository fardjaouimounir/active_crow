import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';

export function useCampaignResource(path, params, options = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['campaigns', user?.id, path, params],
    queryFn: async ({ signal }) => (await apiClient.get(path, { params, signal })).data,
    placeholderData: options.keepPrevious ? keepPreviousData : undefined,
    enabled: options.enabled,
  });
}

export function useCampaigns(filters) {
  return useCampaignResource('/campaigns', filters, { keepPrevious: true });
}

export function useCampaign(id) {
  return useCampaignResource('/campaigns/' + id, undefined, { enabled: Boolean(id) });
}

export function useCampaignDocuments(id) {
  return useCampaignResource('/campaigns/' + id + '/documents');
}

export function useRuleSets(id) {
  return useCampaignResource('/campaigns/' + id + '/rule-sets');
}

export function useRuleSet(campaignId, ruleSetId) {
  return useCampaignResource('/campaigns/' + campaignId + '/rule-sets/' + ruleSetId, undefined, {
    enabled: Boolean(ruleSetId),
  });
}

export function useReadiness(id) {
  return useCampaignResource('/campaigns/' + id + '/readiness');
}

export function useStatusHistory(id) {
  return useCampaignResource('/campaigns/' + id + '/status-history');
}

/** Any JSON write on a campaign; refreshes every campaign query afterwards. */
export function useCampaignWrite() {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ method, path, body }) =>
      (await apiClient.request({ method, url: path, data: body })).data?.data,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

/** Multipart upload of a campaign document, reporting progress (0–100). */
export function useDocumentUpload(campaignId, onProgress) {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async ({ file, label }) => {
      const form = new FormData();
      form.append('label', label);
      form.append('file', file);
      const response = await apiClient.post('/campaigns/' + campaignId + '/documents', form, {
        onUploadProgress: ({ loaded, total }) => {
          if (total) onProgress?.(Math.round((loaded / total) * 100));
        },
      });
      return response.data.data;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

/** Options for `SearchSelect`: `{ value, label }` from any list endpoint. */
function useOptions(key, path, params, toOption, enabled = true) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['campaigns', user?.id, 'options', key, path, params],
    queryFn: async ({ signal }) => (await apiClient.get(path, { params, signal })).data.data,
    enabled,
  });
  return {
    options: (query.data ?? []).map(toOption),
    rows: query.data ?? [],
    pending: query.isPending && enabled,
    error: query.error,
  };
}

export function useClientOptions(search) {
  return useOptions('clients', '/clients', { q: search || undefined }, ({ id, name }) => ({
    value: id,
    label: name,
  }));
}

export function useStaffOptions(search, role) {
  return useOptions(
    'staff',
    '/users',
    { q: search || undefined, role, status: 'active' },
    ({ id, fullName }) => ({ value: id, label: fullName }),
  );
}

export function usePointOptions(search, wilayaId) {
  return useOptions(
    'points',
    '/points-of-sale',
    { q: search || undefined, wilayaId, pageSize: 50 },
    ({ id, name, code }) => ({ value: id, label: name + ' (' + code + ')' }),
    Boolean(wilayaId),
  );
}

export function useClientProducts(clientId) {
  return useOptions(
    'products',
    '/clients/' + clientId + '/products',
    { pageSize: 100 },
    ({ id, name }) => ({ value: id, label: name }),
    Boolean(clientId),
  );
}

/** The client's active gift or sample items (`kind`), as `SelectField` options. */
export function useClientStockItems(clientId, kind) {
  return useOptions(
    'stock-' + kind,
    '/clients/' + clientId + '/stock-items',
    { kind, pageSize: 100 },
    ({ id, name, sku }) => ({ value: id, label: name + ' (' + sku + ')' }),
    Boolean(clientId),
  );
}
