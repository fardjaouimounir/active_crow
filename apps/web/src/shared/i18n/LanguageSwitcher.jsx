import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './index.js';

/** EN / العربية toggle; `compact` drops the leading icon for dense bars. */
export function LanguageSwitcher({ compact = false }) {
  const { t, i18n } = useTranslation('common');
  const current = i18n.resolvedLanguage;

  return (
    <div role="group" aria-label={t('language.label')} className="flex items-center gap-2">
      {!compact && <Languages aria-hidden="true" className="size-4 text-fg-3" strokeWidth={1.5} />}
      <div className="flex rounded-md border border-line p-0.5">
        {LANGUAGES.map(({ code }) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={current === code}
            onClick={() => i18n.changeLanguage(code)}
            className={`h-6 rounded px-2 text-xs font-medium transition-colors duration-[var(--dur-fast)] ${
              current === code
                ? 'bg-accent text-accent-fg'
                : 'text-fg-2 hover:bg-sunken hover:text-fg'
            }`}
          >
            {t(`language.${code}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
