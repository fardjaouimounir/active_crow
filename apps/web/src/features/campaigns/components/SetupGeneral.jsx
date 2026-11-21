import { canEdit as canEditArea } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useFormat } from '../../../ui/format.js';
import { Section } from '../../../ui/viz.jsx';
import { CampaignForm } from './CampaignForm.jsx';
import { formatPeriod } from './CampaignStatus.jsx';

/** Name, dates, budget and approver: editing moved here from the overview, which is now a dashboard. */
export function SetupGeneral({ campaign, canManage }) {
  const { t, i18n } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
  const { money } = useFormat();
  const [saved, setSaved] = useState(false);
  const anyField = ['details', 'startDate', 'endDate', 'approver'].some(
    (area) => canEditArea(campaign, area).allowed,
  );
  return (
    <Section title={tp('campaign.sub.general')}>
      <div className="max-w-3xl">
        {saved && <Toast message={t('admin.saved')} />}
        {canManage && anyField ? (
          <CampaignForm
            key={campaign.version}
            campaign={campaign}
            onSuccess={() => setSaved(true)}
          />
        ) : (
          <dl className="grid gap-3 text-sm">
            {[
              ['client', campaign.client?.name],
              ['period', formatPeriod(campaign, i18n.resolvedLanguage)],
              ['description', campaign.description ?? '—'],
              ['budgetAmount', money(campaign.budgetAmount)],
              ['assignmentApproverRole', t('roles.' + campaign.assignmentApproverRole)],
            ].map(([key, value]) => (
              <div key={key}>
                <dt className="font-medium">
                  {t(key === 'period' ? 'campaigns.period' : 'admin.' + key)}
                </dt>
                <dd>
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Section>
  );
}
