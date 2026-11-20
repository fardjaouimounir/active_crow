import { useTranslation } from 'react-i18next';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { PageHeader, Toast } from '../../shared/ui/PageParts.jsx';
import { NotificationList } from './NotificationList.jsx';
import { useCommunication, useCommunicationWrite } from './api.js';

export function NotificationsPage() {
  const { t } = useTranslation('common');
  const { filters, setFilter } = useFilters();
  const query = useCommunication('/notifications', { page: filters.page, unread: filters.unread });
  const mutation = useCommunicationWrite();
  const { message } = useApiError(mutation.error);
  const meta = query.data?.meta;
  return (
    <>
      <PageHeader title={t('admin.notifications')}>
        <button
          type="button"
          className="underline"
          onClick={() => mutation.mutate({ path: '/notifications/read-all' })}
        >
          {t('notices.readAll')}
        </button>
      </PageHeader>
      <label className="mb-3 flex gap-2">
        <input
          type="checkbox"
          checked={filters.unread === 'true'}
          onChange={(event) => setFilter('unread', event.target.checked ? 'true' : '')}
        />
        {t('notices.unreadOnly')}
      </label>
      <Toast error message={message} />
      <NotificationList query={query} />
      {meta && (
        <div className="mt-3 flex gap-4">
          <button disabled={meta.page <= 1} onClick={() => setFilter('page', meta.page - 1)}>
            {t('admin.previous')}
          </button>
          <button
            disabled={meta.page * meta.pageSize >= meta.total}
            onClick={() => setFilter('page', meta.page + 1)}
          >
            {t('admin.next')}
          </button>
        </div>
      )}
    </>
  );
}
