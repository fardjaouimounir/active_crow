import { Link, useParams } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { BreakdownTable, Cards, DailyChart } from '../../features/reporting/ReportingUi.jsx';
import '../../features/reporting/report-print.css';
import { usePortalExport, usePortalQuery, usePortalText } from './api.js';
import { ProofGallery } from './ProofGallery.jsx';

/** Where the links of a portal page lead: the portal itself, or the director's preview. */
export const portalPaths = (preview, campaignId) =>
  preview
    ? {
        campaign: `/app/campaigns/${campaignId}/client-preview`,
        report: `/app/campaigns/${campaignId}/client-preview/report`,
        tombola: (id) => `/app/tombolas/${id}`,
      }
    : {
        campaign: `/portal/campaigns/${campaignId}`,
        report: `/portal/campaigns/${campaignId}/report`,
        tombola: (id) => `/portal/tombolas/${id}`,
      };

function Commentary({ commentary }) {
  const { t, date } = usePortalText();
  if (!commentary) return null;
  const { output, reviewedAt, period } = commentary;
  const items = (list) => (Array.isArray(list) ? list.map((item) => item?.text ?? item) : []);
  return (
    <section className="space-y-2 rounded-xl border border-accent-line bg-accent-soft/40 p-4">
      <h2 className="font-semibold">{t('commentary')}</h2>
      <p className="text-xs text-fg-2">
        {t('commentaryNote', { date: date(reviewedAt), from: period.from, to: period.to })}
      </p>
      <p dir="auto" className="text-sm">
        {output.narrative}
      </p>
      {[...items(output.risks), ...items(output.opportunities), ...items(output.decisions)].length >
        0 && (
        <ul className="list-disc space-y-1 ps-5 text-sm">
          {[...items(output.risks), ...items(output.opportunities), ...items(output.decisions)].map(
            (line, index) => (
              <li key={index} dir="auto">
                {String(line)}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
}

function Gifts({ kpis }) {
  const { t, number } = usePortalText();
  const rows = [
    ['giftsEntitled', kpis.gifts.entitledUnits],
    ['giftsDelivered', kpis.gifts.distributedUnits],
    ['giftsUndelivered', kpis.gifts.undeliveredUnits],
    ['stockIn', kpis.stock?.stockIn],
    ['losses', kpis.stock?.losses],
    ['returned', kpis.stock?.returnedToClient],
    ['remaining', kpis.stock?.physical],
  ];
  return (
    <section className="report-section space-y-2">
      <h2 className="text-lg font-semibold">{t('gifts')}</h2>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([key, value]) => (
          <div key={key} className="rounded-xl border border-line bg-surface p-3">
            <dt className="text-sm text-fg-2">{t(key)}</dt>
            <dd className="text-xl font-semibold tabular-nums">{number(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Documents({ campaignId }) {
  const { t, dateTime } = usePortalText();
  const query = usePortalQuery(`/portal/campaigns/${campaignId}/documents`);
  const rows = query.data ?? [];
  return (
    <section className="report-actions space-y-2">
      <h2 className="text-lg font-semibold">{t('documents')}</h2>
      {query.data && !rows.length && <p className="text-sm text-fg-2">{t('noDocuments')}</p>}
      <ul className="divide-y rounded-lg border border-line bg-surface">
        {rows.map((row) => (
          <li key={row.fileId} className="flex items-center justify-between gap-3 p-3 text-sm">
            <Link className="underline" to={`/files/${row.fileId}`} dir="auto">
              {row.label ?? row.fileId}
            </Link>
            <span className="text-fg-3">{dateTime(row.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tombolas({ tombolas, preview, campaignId }) {
  const { t } = usePortalText();
  const paths = portalPaths(preview, campaignId);
  if (!tombolas.length) return null;
  return (
    <section className="report-actions space-y-2">
      <h2 className="text-lg font-semibold">{t('tombolas')}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {tombolas.map((tombola) => (
          <li key={tombola.id} className="rounded-xl border border-line bg-surface p-4">
            <p className="font-medium" dir="auto">
              {tombola.name}
            </p>
            <p className="text-sm text-fg-2">{t('tombolaStatus.' + tombola.status)}</p>
            <Link className="mt-2 inline-block underline" to={paths.tombola(tombola.id)}>
              {t('open')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The client's campaign page, and (with `variant="report"`) its printable final report. Also the
 * director's read-only preview (`preview`), which renders exactly the same components.
 */
export function PortalCampaign({ preview = false, variant = 'page' }) {
  const { id } = useParams();
  const { t, language, date } = usePortalText();
  const canExport = useCan('report.export');
  const campaign = usePortalQuery(`/portal/campaigns/${id}`);
  const day = usePortalQuery(`/portal/campaigns/${id}/breakdown`, { dimension: 'day' });
  const wilaya = usePortalQuery(`/portal/campaigns/${id}/breakdown`, { dimension: 'wilaya' });
  const store = usePortalQuery(`/portal/campaigns/${id}/breakdown`, {
    dimension: 'point_of_sale',
  });
  const product = usePortalQuery(`/portal/campaigns/${id}/breakdown`, { dimension: 'product' });
  const download = usePortalExport(language);
  const paths = portalPaths(preview, id);
  const report = variant === 'report';
  if (campaign.isPending) return <p role="status">{t('loading')}</p>;
  if (campaign.isError || !campaign.data) return <p role="alert">{t('error')}</p>;
  const data = campaign.data;
  return (
    <article className="campaign-print-report space-y-6">
      {preview && (
        <p role="note" className="report-actions rounded-md bg-info-soft p-2 text-sm text-info">
          {t('preview')}: {t('previewNote')}
        </p>
      )}
      <header className="space-y-2">
        <p className="text-sm text-fg-2">
          {report ? t('final') : t('report')} · <bdi>{data.code}</bdi> ·{' '}
          <bdi dir="auto">{data.client.name}</bdi>
        </p>
        <h1 className="text-3xl font-semibold" dir="auto">
          {data.name}
        </h1>
        <p>
          <bdi dir="ltr">
            {date(data.startDate)} – {date(data.endDate)}
          </bdi>
        </p>
        {data.provisional && (
          <p className="report-watermark w-fit rounded-md border border-warning-line px-2 py-1 text-warning">
            {t('provisional')}
          </p>
        )}
        <div className="report-actions flex flex-wrap gap-2">
          {!report && (
            <Link className="rounded-md border px-4 py-2" to={paths.report}>
              {t('report')}
            </Link>
          )}
          {report && (
            <button
              type="button"
              className="rounded-md border px-4 py-2"
              onClick={() => window.print()}
            >
              {t('print')}
            </button>
          )}
          {canExport && (
            <button
              type="button"
              disabled={download.isPending}
              className="rounded-md bg-accent px-4 py-2 text-accent-fg disabled:opacity-50"
              onClick={() => download.mutate(id)}
            >
              {t('excel')}
            </button>
          )}
        </div>
        {download.isError && <p role="alert">{t('error')}</p>}
      </header>
      <Cards values={data.kpis} view="client" />
      <Commentary commentary={data.commentary} />
      {day.data && <DailyChart rows={day.data} />}
      {wilaya.data && <BreakdownTable rows={wilaya.data} title="byWilaya" view="client" />}
      {store.data && <BreakdownTable rows={store.data} title="byStore" view="client" />}
      {product.data && <BreakdownTable rows={product.data} title="byProduct" view="client" />}
      <Gifts kpis={data.kpis} />
      {!report && <ProofGallery campaignId={id} />}
      {!report && <Documents campaignId={id} />}
      {!report && <Tombolas tombolas={data.tombolas} preview={preview} campaignId={id} />}
    </article>
  );
}

export const PortalCampaignReport = () => <PortalCampaign variant="report" />;
export const PortalCampaignPreview = () => <PortalCampaign preview />;
export const PortalCampaignPreviewReport = () => <PortalCampaign preview variant="report" />;
