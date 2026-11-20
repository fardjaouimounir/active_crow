import { useTranslation } from 'react-i18next';

/** Pairs a page title with the actions available for that page. */
export function PageHeader({ title, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      {children}
    </div>
  );
}

/** Explains an empty result and optionally includes an action. */
export function EmptyState({ message, children }) {
  const { t } = useTranslation('common');
  return (
    <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
      <p>{message ?? t('admin.empty')}</p>
      {children}
    </div>
  );
}

/** Displays a status using text and a semantic tone. */
export function StatusBadge({ children, tone = 'neutral' }) {
  const styles = {
    good: 'bg-emerald-100 text-emerald-800',
    warn: 'bg-amber-100 text-amber-900',
    neutral: 'bg-slate-100 text-slate-700',
  };
  return (
    <span className={'inline-flex rounded-full px-2.5 py-1 text-xs font-medium ' + styles[tone]}>
      {children}
    </span>
  );
}

/** Announces completion or failure of an operation. */
export function Toast({ message, error = false }) {
  if (!message) return null;
  return (
    <p
      className={
        'rounded-lg p-3 text-sm ' +
        (error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800')
      }
      role={error ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}
