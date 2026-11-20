import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { useLogoutMutation } from '../../features/auth/api.js';
import { useAuth } from '../../shared/auth/hooks.js';
import { LanguageSwitcher } from '../../shared/i18n/LanguageSwitcher.jsx';

/** Signed-in user's name, translated role and the logout button. */
export function UserMenu() {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  // After logout the surface guard sends the user to /login.
  const logout = useLogoutMutation();

  if (!user) return null;
  return (
    <div aria-label={t('user.label')} role="group" className="flex min-w-0 items-center gap-3">
      <div className="min-w-0 text-end leading-tight">
        <p className="truncate text-sm font-medium text-slate-900">{user.fullName}</p>
        <p className="truncate text-xs text-slate-500">{t(`roles.${user.role}`)}</p>
      </div>
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-60"
      >
        <LogOut aria-hidden="true" className="size-4 rtl:-scale-x-100" />
        <span className="sr-only sm:not-sr-only">{t('actions.logout')}</span>
      </button>
    </div>
  );
}

/**
 * Frame shared by the three surfaces: header (product name, surface name, user, language switcher)
 * and the content area filled by child routes.
 * @param {{ surface: 'app' | 'field' | 'portal' }} props
 */
export function SurfaceLayout({ surface }) {
  const { t } = useTranslation('common');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold text-slate-900">{t('appName')}</span>
            <span className="text-sm text-slate-500">{t(`surfaces.${surface}`)}</span>
          </div>
          <div className="flex min-w-0 items-center gap-4">
            <LanguageSwitcher />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
