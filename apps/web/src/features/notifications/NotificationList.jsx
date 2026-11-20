import { Bell, Package, Sparkles, CalendarDays, CircleAlert, Megaphone, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { EmptyState, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useCommunicationWrite } from './api.js';

const icons = {
  assignment: Users,
  campaign: CalendarDays,
  issue: CircleAlert,
  announcement: Megaphone,
  ai_suggestion: Sparkles,
  stock_movement: Package,
};
function destination(item) {
  switch (item.entityType) {
    case 'assignment':
      return item.type === 'assignment.proposed'
        ? '/app/approvals'
        : '/app/campaigns/' + item.payload.campaignId + '?tab=assignments';
    case 'campaign':
      return '/app/campaigns/' + item.entityId;
    case 'stock_movement':
      if (['stock.adjustment_requested', 'stock.transfer_disputed'].includes(item.type))
        return '/app/approvals';
      return item.type === 'stock.transfer_created'
        ? '/app/my-stock'
        : '/app/campaigns/' + item.payload.campaignId + '?tab=stock';
    case 'issue':
      return '/app/issues/' + item.entityId;
    case 'announcement':
      return '/app/announcements/' + item.entityId;
    case 'ai_suggestion':
      return item.type === 'ai.suggestion_received'
        ? '/app/ai-review/' + item.entityId
        : '/app/dashboard';
    default:
      return '/app/notifications';
  }
}

export function NotificationList({ query, onNavigate }) {
  const { t, i18n } = useTranslation('common');
  const mutation = useCommunicationWrite();
  const { message } = useApiError(query.error ?? mutation.error);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (message) return <Toast error message={message} />;
  const items = query.data.data;
  if (!items.length) return <EmptyState />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => {
        const Icon = icons[item.entityType] ?? Bell;
        return (
          <li key={item.id} className={item.readAt ? '' : 'bg-blue-50'}>
            <Link
              className="flex items-center gap-3 p-3 text-sm hover:bg-slate-100"
              to={destination(item)}
              onClick={() => {
                if (!item.readAt) mutation.mutate({ path: '/notifications/' + item.id + '/read' });
                onNavigate?.();
              }}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span>
                {t('notices.events.' + item.type.replace('.', '_'))}
                <small className="block text-slate-500">
                  {date.format(new Date(item.createdAt))}
                </small>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
