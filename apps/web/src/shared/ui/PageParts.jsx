import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/primitives.jsx';
import { EmptyState as KitEmptyState } from '../../ui/data.jsx';

/** Pairs a page title with the actions available for that page. */
export function PageHeader({ title, children }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
      {children}
    </div>
  );
}

/** Explains an empty result and optionally includes an action. */
export function EmptyState({ message, children }) {
  const { t } = useTranslation('common');
  return <KitEmptyState message={message ?? t('admin.empty')}>{children}</KitEmptyState>;
}

const TONES = { good: 'good', warn: 'warn', neutral: 'neutral', bad: 'bad', info: 'info' };

/** Displays a status using icon, text and a semantic tone. */
export function StatusBadge({ children, tone = 'neutral' }) {
  return <Badge tone={TONES[tone] ?? 'neutral'}>{children}</Badge>;
}

/** Announces completion or failure of an operation. */
export function Toast({ message, error = false }) {
  if (!message) return null;
  return (
    <p
      className={
        'rounded-lg border p-3 text-sm ' +
        (error
          ? 'border-danger-line bg-danger-soft text-danger'
          : 'border-success-line bg-success-soft text-success')
      }
      role={error ? 'alert' : 'status'}
    >
      {message}
    </p>
  );
}
