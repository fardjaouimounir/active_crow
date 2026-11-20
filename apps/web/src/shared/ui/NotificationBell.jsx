import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCommunication, useCommunicationWrite } from '../../features/notifications/api.js';
import { NotificationList } from '../../features/notifications/NotificationList.jsx';

export function NotificationBell() {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const unread = useCommunication('/notifications/unread-count', undefined, {
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });
  const latest = useCommunication('/notifications', { pageSize: 10 }, { enabled: open });
  const mutation = useCommunicationWrite();
  const count = unread.data?.data.count ?? 0;
  return (
    <div className="relative">
      <button
        type="button"
        className="relative rounded-lg p-2 hover:bg-slate-100"
        aria-label={t('notices.bell', { count })}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell aria-hidden className="size-5" />
        {count > 0 && (
          <span className="absolute -top-1 end-0 rounded-full bg-red-700 px-1 text-xs text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-30 max-h-[70vh] overflow-y-auto rounded-xl border bg-white p-3 shadow-lg sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:w-80">
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
            <Link className="underline" to="/app/notifications" onClick={() => setOpen(false)}>
              {t('admin.notifications')}
            </Link>
            <button
              type="button"
              className="underline"
              disabled={!count || mutation.isPending}
              onClick={() => mutation.mutate({ path: '/notifications/read-all' })}
            >
              {t('notices.readAll')}
            </button>
          </div>
          {mutation.isError && <p role="alert">{t('errors.codes.INTERNAL_ERROR')}</p>}
          <NotificationList query={latest} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
