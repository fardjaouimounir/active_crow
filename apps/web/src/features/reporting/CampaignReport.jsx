import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PrintBrand, buttonClass } from '../../ui/primitives.jsx';
import { useAuth } from '../../shared/auth/hooks.js';
import { CampaignAiActions, CampaignAiCards } from '../ai/AiUi.jsx';
import { useReport } from './api.js';
import {
  BreakdownTable,
  Cards,
  DailyChart,
  ExportButton,
  ReportTable,
  useReportingText,
} from './ReportingUi.jsx';
import './report-print.css';

export function CampaignReport() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t, num, language } = useReportingText();
  const { t: common } = useTranslation('common');
  const permitted = ['director', 'general_manager'].includes(user.role);
  const { data, isError, isPending } = useReport(`/campaigns/${id}/summary`, {}, permitted);
  const date = (value) =>
    new Intl.DateTimeFormat(language + '-u-nu-latn', {
      timeZone: 'Africa/Algiers',
      dateStyle: 'medium',
    }).format(new Date(value));
  if (!permitted || isError) return <p role="alert">{t('error')}</p>;
  if (isPending) return <p role="status">{t('loading')}</p>;
  const { campaign, kpis, daily, wilayas, stores, reconciliation, issues } = data;
  return (
    <article className="campaign-print-report space-y-6">
      <PrintBrand tagline={common('brand.tagline')} />
      <header className="space-y-2">
        <p className="text-sm text-fg-2">
          {t('report')} · <bdi>{campaign.code}</bdi>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">{campaign.name}</h1>
        <p>
          <bdi>{campaign.client.name}</bdi> ·{' '}
          <bdi dir="ltr">
            {date(campaign.startDate)} – {date(campaign.endDate)}
          </bdi>
        </p>
        <p>{common('campaigns.status.' + campaign.status)}</p>
        {campaign.pointsOfSale && (
          <dl className="flex flex-wrap gap-4 text-sm">
            {[
              ['wilayaIds', campaign.wilayas.length],
              ['pointOfSaleIds', campaign.pointsOfSale.length],
              ['supervisorIds', campaign.supervisorCount],
              ['animateurIds', campaign.animateurCount],
            ].map(([key, value]) => (
              <div key={key}>
                <dt>{t(key)}</dt>
                <dd className="font-semibold">{num(value)}</dd>
              </div>
            ))}
          </dl>
        )}
        <p>
          {t('generated')} <bdi dir="ltr">{date(data.generatedAt)}</bdi>
        </p>
        {campaign.status !== 'closed' && (
          <p className="report-watermark w-fit rounded-md border border-warning-line px-2 py-1 text-warning">
            {t('provisional')}
          </p>
        )}
        <div className="report-actions flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass({ variant: 'secondary' })}
            onClick={() => window.print()}
          >
            {t('print')}
          </button>
          <ExportButton id={id} />
        </div>
        <div className="report-actions">
          <CampaignAiActions
            campaignId={id}
            period={{ from: kpis.period?.from, to: kpis.period?.to }}
            salesTarget={kpis.completion?.salesTarget}
          />
        </div>
      </header>
      <Cards values={kpis} />
      <CampaignAiCards campaignId={id} period={kpis.period} />
      <DailyChart rows={daily} />
      <BreakdownTable rows={wilayas} title="byWilaya" />
      <BreakdownTable rows={stores} title="byStore" />
      <section className="report-section space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">{t('reconciliation')}</h2>
        <dl className="max-w-md text-sm">
          {['stockIn', 'customers', 'losses', 'returnedToClient', 'physical'].map((key) => (
            <div key={key} className="flex justify-between border-b border-line py-1">
              <dt className="text-fg-2">{t(key)}</dt>
              <dd className="tnum font-medium">{num(reconciliation?.[key])}</dd>
            </div>
          ))}
        </dl>
      </section>
      <ReportTable
        rows={issues}
        title={t('issues')}
        columns={[
          ['category', (row) => common('issues.categories.' + row.category)],
          ['status', (row) => common('issues.status.' + row.status)],
          ['count', (row) => num(row.count)],
        ]}
      />
    </article>
  );
}
