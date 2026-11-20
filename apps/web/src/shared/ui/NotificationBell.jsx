import { Bell } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCommunication, useCommunicationWrite } from '../../features/notifications/api.js';
import { NotificationList } from '../../features/notifications/NotificationList.jsx';
import { IconButton } from '../../ui/controls.jsx';

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
      <IconButton
        label={t('notices.bell', { count })}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell aria-hidden="true" size={16} strokeWidth={1.5} />
        {count > 0 && (
          <span className="tnum absolute -top-0.5 -end-0.5 min-w-4 rounded-full bg-accent px-1 text-center text-2xs leading-4 font-semibold text-accent-fg">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </IconButton>
      {open && (
        <div className="fixed inset-x-3 top-14 z-30 max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-raised p-3 shadow-lg sm:absolute sm:inset-x-auto sm:end-0 sm:top-full sm:mt-1.5 sm:w-96">
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm">
            <Link
              className="font-medium text-accent-text underline-offset-4 hover:underline"
              to="/app/notifications"
              onClick={() => setOpen(false)}
            >
              {t('admin.notifications')}
            </Link>
            <button
              type="button"
              className="text-fg-2 underline-offset-4 hover:underline disabled:opacity-50"
              disabled={!count || mutation.isPending}
              onClick={() => mutation.mutate({ path: '/notifications/read-all' })}
            >
              {t('notices.readAll')}
            </button>
          </div>
          {mutation.isError && (
            <p role="alert" className="text-danger">
              {t('errors.codes.INTERNAL_ERROR')}
            </p>
          )}
          <NotificationList query={latest} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
