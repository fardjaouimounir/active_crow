import { useEffect } from 'react';
import { Link, useParams } from 'react-router';
import '../../features/reporting/report-print.css';
import { usePortalQuery, usePortalText, useVerifyDraw } from './api.js';
import { Hash, drawnByText } from './PortalTombola.jsx';

/**
 * The printable record of a draw: everything needed to understand and recompute it. Contacts are
 * masked. Print or save as PDF from the browser, like the final report.
 */
export function TombolaRecord({ staff = false }) {
  const { id } = useParams();
  const { t, dateTime, number } = usePortalText();
  const tombola = usePortalQuery(`/tombolas/${id}`);
  const winners = usePortalQuery(`/tombolas/${id}/winners`, undefined, Boolean(tombola.data?.draw));
  const verify = useVerifyDraw(id, tombola.data?.commitment?.entriesHash);
  const drawn = Boolean(tombola.data?.draw);
  const { mutate } = verify;
  useEffect(() => {
    if (drawn) mutate();
  }, [drawn, mutate]);
  if (tombola.isPending) return <p role="status">{t('loading')}</p>;
  if (tombola.isError || !tombola.data) return <p role="alert">{t('error')}</p>;
  const data = tombola.data;
  const published = verify.data?.data;
  const rows = winners.data ?? [];
  return (
    <article className="campaign-print-report space-y-5">
      <div className="report-actions flex flex-wrap gap-2">
        <Link
          className="rounded-md border px-4 py-2"
          to={staff ? `/app/tombolas/${id}` : `/portal/tombolas/${id}`}
        >
          {t('back')}
        </Link>
        <button
          type="button"
          className="rounded-md border px-4 py-2"
          onClick={() => window.print()}
        >
          {t('print')}
        </button>
      </div>
      <header className="space-y-1">
        <p className="text-sm text-slate-600">{t('recordTitle')}</p>
        <h1 className="text-3xl font-semibold" dir="auto">
          {data.name}
        </h1>
        <p dir="auto">
          {data.campaign.name} · <bdi>{data.campaign.code}</bdi>
        </p>
      </header>
      <dl className="report-section grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">{t('rules')}</dt>
          <dd>
            {t(data.entryBasis === 'per_unit' ? 'perUnit' : 'perSale', { n: data.entriesPerBasis })}
            {data.maxEntriesPerCustomer && (
              <> · {t('maxEntries', { n: data.maxEntriesPerCustomer })}</>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('registrationEnds')}</dt>
          <dd>{dateTime(data.registrationEndsAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t('drawScheduled')}</dt>
          <dd>{dateTime(data.drawScheduledAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">
            {t('winners')} / {t('reserves')}
          </dt>
          <dd>
            {number(data.winnersCount)} / {number(data.reservesCount)}
          </dd>
        </div>
      </dl>
      {data.commitment && (
        <section className="report-section space-y-1 text-sm">
          <h2 className="text-lg font-semibold">{t('commitment')}</h2>
          <p>
            {t('eligibleEntries')}: <b>{number(data.commitment.eligibleCount)}</b> ·{' '}
            {t('committedAt')}: {dateTime(data.commitment.committedAt)}
          </p>
          <Hash value={data.commitment.entriesHash} />
        </section>
      )}
      {data.draw ? (
        <>
          <section className="report-section space-y-1 text-sm">
            <h2 className="text-lg font-semibold">{t('drawTitle')}</h2>
            <p>
              {t('drawnBy')}: {drawnByText(t, data.draw.drawnBy)} · {t('drawnAt')}:{' '}
              {dateTime(data.draw.drawnAt)}
            </p>
            <p>
              {t('algorithm')}: <bdi dir="ltr">{data.draw.algorithm}</bdi>
            </p>
            {published && (
              <>
                <p>
                  {t('clientNonce')}: <bdi dir="auto">{published.clientNonce || '—'}</bdi>
                </p>
                <p>
                  {t('serverRandom')}: <Hash value={published.serverRandom} />
                </p>
                <p>
                  {t('seed')}: <Hash value={published.seed} />
                </p>
              </>
            )}
            {verify.data && (
              <p>{verify.data.result.ok ? '✓ ' + t('verifyOk') : '✗ ' + t('verifyFail')}</p>
            )}
          </section>
          <section className="report-section space-y-2">
            <h2 className="text-lg font-semibold">{t('winners')}</h2>
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b">
                  {['rank', 'entryNumber', 'customer', 'prize', 'delivery'].map((key) => (
                    <th key={key} scope="col" className="p-2 text-start">
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b">
                    <td className="p-2">
                      {row.isReserve
                        ? row.servesRank
                          ? t('reserveFor', { rank: row.servesRank })
                          : t('reserve')
                        : row.rank}
                    </td>
                    <td className="p-2">
                      <bdi>{row.entryNumber}</bdi>
                    </td>
                    <td className="p-2">
                      <bdi dir="auto">{row.customer?.fullName}</bdi>{' '}
                      <bdi dir="ltr">{row.customer?.phone}</bdi>
                    </td>
                    <td className="p-2" dir="auto">
                      {row.prizeLabel ?? '—'}
                    </td>
                    <td className="p-2">{t('delivery.' + row.deliveryStatus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <p>{t('tombolaStatus.' + data.status)}</p>
      )}
    </article>
  );
}

export const StaffTombolaRecord = () => <TombolaRecord staff />;
