import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../../shared/i18n/LanguageSwitcher.jsx';

/**
 * Centred card used by the login and change-password pages (works from 360 px wide).
 * @param {{ title: string, subtitle?: string, children: import('react').ReactNode }} props
 */
export function AuthCard({ title, subtitle, children }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-between gap-4">
          <span className="text-lg font-semibold text-slate-900">{t('appName')}</span>
          <LanguageSwitcher />
        </div>
        <main className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
