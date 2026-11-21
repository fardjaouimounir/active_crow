import { verifyDraw } from '@fieldflow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '../../shared/api/client.js';
import { useAuth } from '../../shared/auth/hooks.js';
import { formatNumber, formatPercent } from '../../ui/format.js';
import { messages } from './messages.js';

/** Texts and number/date formats of the portal in the active language. */
export function usePortalText() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const rtl = language.startsWith('ar');
  const locale = rtl ? 'ar-DZ-u-nu-latn' : 'en-GB';
  const t = (key, values = {}) =>
    Object.entries(values).reduce(
      (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
      messages[key]?.[rtl ? 1 : 0] ?? key,
    );
  const date = (value) =>
    value
      ? new Intl.DateTimeFormat(locale, { timeZone: 'Africa/Algiers', dateStyle: 'medium' }).format(
          new Date(value),
        )
      : '—';
  const dateTime = (value) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          timeZone: 'Africa/Algiers',
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(value))
      : '—';
  const number = (value) => formatNumber(value, { rtl });
  const percent = (value) => formatPercent(value);
  const wilaya = (item) => (rtl && item?.nameAr) || item?.nameEn || '';
  return { t, rtl, language, locale, date, dateTime, number, percent, wilaya };
}

/** GET query keyed by user, so a session change never shows the previous user's data. */
export function usePortalQuery(path, params, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['portal', user?.id, path, params ?? null],
    enabled,
    queryFn: async ({ signal }) => (await apiClient.get(path, { params, signal })).data.data,
  });
}

export function usePortalWrite() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ path, method = 'post', body }) =>
      (await apiClient[method](path, body)).data.data,
    onSuccess: () => client.invalidateQueries({ queryKey: ['portal'] }),
  });
}

export function usePortalExport(language) {
  return useMutation({
    mutationFn: async (campaignId) => {
      const response = await apiClient.get(`/portal/campaigns/${campaignId}/export.xlsx`, {
        responseType: 'arraybuffer',
        transformResponse: [
          (body, headers) =>
            headers['content-type']?.includes('application/json')
              ? JSON.parse(new TextDecoder().decode(body))
              : body,
        ],
        headers: { 'Accept-Language': language },
      });
      const url = URL.createObjectURL(
        new Blob([response.data], { type: response.headers['content-type'] }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = 'fieldflow-report.xlsx';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
}

/** The published draw data, plus the browser's own recomputation of it (same shared function). */
export function useVerifyDraw(tombolaId, committedHash) {
  return useMutation({
    mutationFn: async () => {
      const data = (await apiClient.get(`/tombolas/${tombolaId}/draw/verification`)).data.data;
      const result = await verifyDraw(data);
      // The list must also be the one committed (and published) when registration closed.
      if (committedHash && data.entriesHash !== committedHash) result.ok = false;
      return { data, result };
    },
  });
}
