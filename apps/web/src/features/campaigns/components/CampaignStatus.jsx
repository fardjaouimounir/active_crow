import { LIFECYCLE_STEPS } from '@fieldflow/shared';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../../shared/ui/PageParts.jsx';

const TONES = {
  active: 'good',
  assigned: 'good',
  suspended: 'warn',
  planning: 'warn',
  cancelled: 'bad',
};

/**
 * Status chip: the status pill (icon + text) followed by a row of dots showing how far along the
 * lifecycle the campaign is. The dots are decorative; the text carries the meaning.
 */
export function CampaignStatus({ status }) {
  const { t } = useTranslation('common');
  const position = LIFECYCLE_STEPS.indexOf(status === 'suspended' ? 'active' : status);
  return (
    <span className="inline-flex items-center gap-2">
      <StatusBadge tone={TONES[status] ?? 'neutral'}>{t('campaigns.status.' + status)}</StatusBadge>
      {position >= 0 && (
        <span aria-hidden="true" className="inline-flex items-center gap-0.5">
          {LIFECYCLE_STEPS.map((step, index) => (
            <span
              key={step}
              className={
                'h-1 w-2.5 rounded-full ' +
                (index < position
                  ? 'bg-accent-text'
                  : index === position
                    ? 'bg-accent'
                    : 'bg-line-strong')
              }
            />
          ))}
        </span>
      )}
    </span>
  );
}

/** "10 Feb 2027 – 12 Mar 2027" in the UI language (business dates, no time zone shift). */
export function formatPeriod(campaign, language) {
  const format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' });
  return format.formatRange(
    new Date(campaign.startDate + 'T00:00:00Z'),
    new Date(campaign.endDate + 'T00:00:00Z'),
  );
}
