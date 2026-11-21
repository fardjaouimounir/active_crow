import { LIFECYCLE_STEPS } from '@fieldflow/shared';
import { CircleX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { StatusBadge } from '../../../shared/ui/PageParts.jsx';
import { Stepper } from '../../../ui/data.jsx';

/** The tab where a blocker can be fixed (no link when it is fixed elsewhere or by time). */
const FIX_TAB = {
  NO_WILAYA_WITH_NEED: 'coverage',
  NO_PRODUCT: 'products',
  NO_APPROVED_RULE_SET: 'rules',
  NO_POINT_OF_SALE: 'pointsOfSale',
  WILAYA_WITHOUT_SUPERVISOR: 'coverage',
  WILAYA_WITHOUT_REGIONAL: 'coverage',
  BEFORE_START_DATE: 'overview',
  AFTER_END_DATE: 'overview',
};

/** Lifecycle position for the campaign header: planning → … → closed, with suspended / cancelled notes. */
export function LifecycleStepper({ status }) {
  const { t } = useTranslation('common');
  const cancelled = status === 'cancelled';
  return (
    <div className="grid gap-2">
      <Stepper
        label={t('campaigns.lifecycle.title')}
        steps={LIFECYCLE_STEPS.map((step) => ({ key: step, label: t('campaigns.status.' + step) }))}
        current={cancelled ? null : status === 'suspended' ? 'active' : status}
      />
      {status === 'suspended' && (
        <StatusBadge tone="warn">{t('campaigns.lifecycle.suspendedNote')}</StatusBadge>
      )}
      {cancelled && (
        <p role="status" className="flex items-center gap-2 text-sm text-danger">
          <CircleX aria-hidden="true" size={16} />
          {t('campaigns.lifecycle.cancelledNote')}
        </p>
      )}
    </div>
  );
}

export function BlockerList({ blockers, wilayaName }) {
  const { t, i18n } = useTranslation('common');
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone: 'UTC',
    dateStyle: 'medium',
  });
  const day = (iso) => date.format(new Date(iso + 'T00:00:00Z'));
  return (
    <ul className="space-y-1.5 text-sm">
      {blockers.map((blocker, index) => {
        const details = blocker.details ?? {};
        const tab = FIX_TAB[blocker.code];
        return (
          <li key={blocker.code + index} className="flex items-start gap-2">
            <CircleX aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-danger" />
            <span>
              {t('campaigns.blockers.' + blocker.code, {
                defaultValue: blocker.code,
                wilayas: (details.wilayaIds ?? []).map(wilayaName).join(', '),
                startDate: details.startDate ? day(details.startDate) : '',
                endDate: details.endDate ? day(details.endDate) : '',
                count: details.count ?? 0,
              })}{' '}
              {tab && (
                <Link
                  className="text-accent-text underline underline-offset-4"
                  to={{ search: '?tab=' + tab }}
                >
                  {t('campaigns.lifecycle.fixIn', { tab: t('campaigns.tabs.' + tab) })}
                </Link>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
