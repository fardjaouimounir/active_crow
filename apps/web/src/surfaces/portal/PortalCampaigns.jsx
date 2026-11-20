import { Link } from 'react-router';
import { usePortalQuery, usePortalText } from './api.js';

/** The campaigns of the signed-in client, with their headline results. */
export function PortalCampaigns() {
  const { t, date, number, percent, wilaya } = usePortalText();
  const query = usePortalQuery('/portal/campaigns');
  const rows = query.data ?? [];
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('campaigns')}</h1>
      {rows[0]?.client && (
        <p className="text-slate-600">
          <bdi dir="auto">{rows[0].client.name}</bdi>
        </p>
      )}
      {query.isPending && <p role="status">{t('loading')}</p>}
      {query.isError && <p role="alert">{t('error')}</p>}
      {query.data && !rows.length && <p>{t('noCampaigns')}</p>}
      <ul className="grid gap-4 md:grid-cols-2">
        {rows.map((campaign) => (
          <li
            key={campaign.id}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold" dir="auto">
                  {campaign.name}
                </h2>
                <p className="text-xs text-slate-500">
                  <bdi>{campaign.code}</bdi> · {campaign.status}
                </p>
              </div>
              {campaign.provisional && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">
                  {t('provisional')}
                </span>
              )}
            </div>
            <p className="text-sm">
              <bdi>
                {date(campaign.startDate)} – {date(campaign.endDate)}
              </bdi>
            </p>
            <p className="text-sm text-slate-600">
              {campaign.wilayas.map((item) => wilaya(item)).join(' · ')}
            </p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[
                ['unitsSold', number(campaign.headline.units)],
                ['buyers', number(campaign.headline.buyers)],
                ['giftsDistributed', number(campaign.headline.distributedUnits)],
                ['completion', percent(campaign.headline.completionRate)],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt className="text-slate-600">{t(key)}</dt>
                  <dd className="font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <Link
              className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
              to={`/portal/campaigns/${campaign.id}`}
            >
              {t('open')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
