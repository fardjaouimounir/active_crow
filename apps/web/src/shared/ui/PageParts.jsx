import { useTranslation } from 'react-i18next';
import { Badge } from '../../ui/primitives.jsx';
import { EmptyState as KitEmptyState } from '../../ui/data.jsx';

/**
 * Page header: title, one muted context line (period, status, count) and right-aligned actions
 * (`children`). The breadcrumb lives in the top bar, so the header starts right under it.
 */
export function PageHeader({ title, context, badge, children }) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {badge}
        </div>
        {context && <div className="mt-1 text-sm text-fg-3">{context}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
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
