import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from './index.js';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const current = i18n.resolvedLanguage;

  return (
    <div role="group" aria-label={t('language.label')} className="flex items-center gap-2">
      <Languages aria-hidden="true" className="size-4 text-slate-500" />
      <div className="flex rounded-lg border border-slate-200 p-0.5">
        {LANGUAGES.map(({ code }) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={current === code}
            onClick={() => i18n.changeLanguage(code)}
            className={`rounded-md px-3 py-1 text-sm transition-colors ${
              current === code
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {t(`language.${code}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
