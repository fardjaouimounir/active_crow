import { Bell, Camera, CircleAlert, House, ShoppingBag } from 'lucide-react';
import { useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';
import { logout } from '../../shared/auth/session.js';
import i18n from '../../shared/i18n/index.js';
import { useFieldQuery } from '../../surfaces/field/api.js';
import ar from '../../surfaces/field/ar.json';
import en from '../../surfaces/field/en.json';
import { secondary } from '../../surfaces/field/ui.jsx';

const storage = 'fieldflow.field.language';
const tabs = [
  ['today', '/field', House],
  ['attendance', '/field/attendance', Camera],
  ['sale', '/field/sale', ShoppingBag],
  ['issue', '/field/issue', CircleAlert],
];
let registered = false;

function preferredLanguage() {
  try {
    return localStorage.getItem(storage) === 'en' ? 'en' : 'ar';
  } catch {
    return 'ar';
  }
}

function connection() {
  return globalThis.navigator?.onLine !== false;
}

function BellMenu() {
  const { t } = useTranslation(['field', 'common']);
  const [open, setOpen] = useState(false);
  const query = useFieldQuery('/notifications', { pageSize: 8 }, open);
  const items = query.data?.data ?? [];
  return (
    <div className="relative">
      <button
        type="button"
        className={secondary + ' size-12 px-0'}
        aria-label={t('notifications')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={20} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute end-0 top-14 z-30 grid max-h-72 w-64 gap-1 overflow-auto rounded-xl border bg-white p-2 shadow-xl">
          {items.length ? (
            items.map((item) => {
              const target = item.type?.startsWith('attendance.')
                ? '/field/attendance'
                : item.type?.startsWith('stock.')
                  ? '/field#stock'
                  : item.type === 'entitlement.undelivered'
                    ? '/field#undelivered'
                    : '/field/issue';
              return (
                <Link
                  className="flex min-h-12 items-center rounded-lg px-2 hover:bg-slate-100"
                  to={target}
                  key={item.id}
                  onClick={() => setOpen(false)}
                >
                  {t('notices.events.' + item.type?.replaceAll('.', '_'), {
                    ns: 'common',
                    defaultValue: t('notifications'),
                  })}
                </Link>
              );
            })
          ) : (
            <p className="p-3">{t('noNotifications')}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Shell() {
  const { t, i18n: locale } = useTranslation(['field', 'common']);
  const [online, setOnline] = useState(connection);
  const [reachable, setReachable] = useState(true);
  const [install, setInstall] = useState(null);
  const sale = useFieldQuery('/me/sales/today');
  const attendance = useFieldQuery('/me/attendance/today');
  const field = sale.data?.data?.field;
  const current = attendance.data?.data?.assignments?.find(
    (row) => row.assignmentId === field?.assignmentId,
  );
  useEffect(() => {
    const changeOnline = () => {
      setOnline(connection());
      if (connection()) setReachable(true);
    };
    const changeReachable = (event) => setReachable(event.detail);
    const offer = (event) => {
      event.preventDefault();
      setInstall(event);
    };
    const installed = () => setInstall(null);
    window.addEventListener('online', changeOnline);
    window.addEventListener('offline', changeOnline);
    window.addEventListener('fieldflow:connection', changeReachable);
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', installed);
    if (!registered && import.meta.env.PROD && navigator.serviceWorker) {
      registered = true;
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        registered = false;
      });
    }
    return () => {
      window.removeEventListener('online', changeOnline);
      window.removeEventListener('offline', changeOnline);
      window.removeEventListener('fieldflow:connection', changeReachable);
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  const language = locale.resolvedLanguage ?? 'ar';
  const onlineStatus = online && reachable ? 'online' : 'offline';
  function switchLanguage() {
    const next = language === 'ar' ? 'en' : 'ar';
    try {
      localStorage.setItem(storage, next);
    } catch {
      /* Preference is available in this tab. */
    }
    void locale.changeLanguage(next);
  }
  return (
    <div
      lang={language}
      dir={locale.dir(language)}
      className="min-h-dvh bg-slate-50 text-base text-slate-950"
    >
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white [padding-top:env(safe-area-inset-top)]">
        <div className="mx-auto grid max-w-xl grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-bold">{field?.campaignName ?? 'FieldFlow'}</p>
            {field && <p className="truncate">{field.pointOfSale.name}</p>}
            <p
              role="status"
              className={onlineStatus === 'online' ? 'text-teal-800' : 'text-red-800'}
            >
              {t(onlineStatus)}
            </p>
          </div>
          <div className="flex gap-1">
            <BellMenu />
            <button
              className={secondary + ' size-12 px-0'}
              onClick={switchLanguage}
              aria-label={t('language')}
            >
              {language === 'ar' ? 'EN' : 'ع'}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-xl gap-4 px-3 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <Outlet
          context={{
            sale,
            attendance,
            field,
            current,
            install,
            installApp: async () => {
              await install?.prompt();
              setInstall(null);
            },
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-slate-700">{t('roles.animateur', { ns: 'common' })}</p>
          <button className={secondary} onClick={() => void logout()}>
            {t('logout')}
          </button>
        </div>
      </main>
      <nav
        aria-label={t('navigation')}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white [padding-bottom:env(safe-area-inset-bottom)]"
      >
        <div className="mx-auto grid max-w-xl grid-cols-4 gap-1 p-1">
          {tabs.map(([name, url, Icon]) => (
            <NavLink
              key={name}
              to={url}
              end
              className={({ isActive }) =>
                'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1 font-semibold ' +
                (isActive ? 'bg-teal-800 text-white' : 'text-slate-800 hover:bg-slate-100')
              }
            >
              <Icon size={20} aria-hidden="true" />
              {t(name)}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function FieldLayout() {
  const [locale] = useState(() => {
    const instance = i18n.cloneInstance({ lng: preferredLanguage(), initAsync: false });
    instance.addResourceBundle('ar', 'field', ar);
    instance.addResourceBundle('en', 'field', en);
    return instance;
  });
  return (
    <I18nextProvider i18n={locale}>
      <Shell />
    </I18nextProvider>
  );
}
