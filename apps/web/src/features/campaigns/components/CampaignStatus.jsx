import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../../shared/ui/PageParts.jsx';

const TONES = { active: 'good', assigned: 'good', suspended: 'warn', planning: 'warn' };

export function CampaignStatus({ status }) {
  const { t } = useTranslation('common');
  return (
    <StatusBadge tone={TONES[status] ?? 'neutral'}>{t('campaigns.status.' + status)}</StatusBadge>
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
