import { useTranslation } from 'react-i18next';
import { Outlet } from 'react-router';
import { LanguageSwitcher } from '../../shared/i18n/LanguageSwitcher.jsx';

/**
 * Frame shared by the three surfaces: header (product name, surface name, language switcher)
 * and an empty content area filled by child routes.
 * @param {{ surface: 'app' | 'field' | 'portal' }} props
 */
export function SurfaceLayout({ surface }) {
  const { t } = useTranslation('common');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-semibold text-slate-900">{t('appName')}</span>
            <span className="text-sm text-slate-500">{t(`surfaces.${surface}`)}</span>
          </div>
          <LanguageSwitcher />
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
