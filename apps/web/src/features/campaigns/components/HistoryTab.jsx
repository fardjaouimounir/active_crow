import { useTranslation } from 'react-i18next';
import { EmptyState, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useStatusHistory } from '../api.js';

/** Status history timeline, oldest first. */
export function HistoryTab({ campaignId }) {
  const { t, i18n } = useTranslation('common');
  const history = useStatusHistory(campaignId);
  const { message } = useApiError(history.error);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone: 'Africa/Algiers',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  if (history.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (history.isError) return <Toast error message={message} />;
  const rows = history.data.data;
  if (!rows.length) return <EmptyState />;
  return (
    <ol className="grid gap-3">
      {rows.map((row) => (
        <li key={row.id} className="border-s-2 border-slate-300 ps-3 text-sm">
          <p className="font-medium">
            {row.fromStatus ? t('campaigns.status.' + row.fromStatus) + ' → ' : ''}
            {t('campaigns.status.' + row.toStatus)}
          </p>
          <p className="text-slate-600">
            {date.format(new Date(row.createdAt))}
            {row.changedBy ? ' · ' + row.changedBy.fullName : ''}
          </p>
          {row.reason && <p>{row.reason}</p>}
        </li>
      ))}
    </ol>
  );
}
