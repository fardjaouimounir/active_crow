import { useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from '../../../shared/i18n/LanguageSwitcher.jsx';
import { ThemeToggle } from '../../../ui/controls.jsx';
import { messages } from './brandMessages.js';
import { applySurface } from '../../../ui/theme.js';
import { LogoMark, Wordmark } from '../../../ui/primitives.jsx';

/**
 * Split layout for login and change-password: the brand stripe panel (mark, promise, tagline)
 * beside a plain form column. Below 1024 px the panel shrinks to a header band (works from 360 px).
 * @param {{ title: string, subtitle?: string, children: import('react').ReactNode }} props
 */
export function AuthCard({ title, subtitle, children }) {
  const { t } = useTranslation('common');
  useLayoutEffect(() => {
    applySurface('app');
  }, []);
  const { i18n } = useTranslation();
  const index = (i18n.resolvedLanguage ?? 'en').startsWith('ar') ? 1 : 0;
  const points = messages.loginPoints[index];
  return (
    <div className="grid min-h-screen bg-canvas text-fg lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <aside
        data-theme="dark"
        className="brand-stripe flex min-h-44 flex-col justify-between gap-10 px-6 py-6 text-fg lg:min-h-screen lg:px-12 lg:py-10"
      >
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <LogoMark size={40} />
            <Wordmark className="text-2xl text-brand-white" />
          </div>
          <p className="text-sm font-medium text-brand-white">{t('brand.tagline')}</p>
        </div>
        <div className="hidden max-w-md space-y-5 lg:block">
          <p className="text-4xl leading-tight font-bold tracking-tight text-brand-white">
            {messages.loginTitle[index]}
          </p>
          <ul className="space-y-2 text-base text-brand-white">
            {Array.isArray(points) &&
              points.map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
                  {point}
                </li>
              ))}
          </ul>
        </div>
      </aside>
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-end gap-2">
          <LanguageSwitcher compact />
          <ThemeToggle />
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-fg-2">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </main>
        <p className="text-center text-xs text-fg-3 lg:text-start">{t('brand.tagline')}</p>
      </div>
    </div>
  );
}
