import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { ShieldCheck } from 'lucide-react';
import { buttonClass, controlClass } from '../../ui/primitives.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { usePortalQuery, usePortalText, usePortalWrite, useVerifyDraw } from './api.js';

const field = controlClass;
const button = buttonClass({ variant: 'secondary' });
const primary = buttonClass({ variant: 'primary' });

const randomPhrase = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');

/** Short hexadecimal fingerprints are shown whole, left to right, and can be selected. */
export function Hash({ value }) {
  return (
    <bdi dir="ltr" className="break-all font-mono text-xs">
      {value}
    </bdi>
  );
}

function DrawForm({ tombola }) {
  const { t } = usePortalText();
  const write = usePortalWrite();
  const { message } = useApiError(write.error);
  const [nonce, setNonce] = useState('');
  const [labels, setLabels] = useState(() => Array(tombola.winnersCount).fill(''));
  const [confirming, setConfirming] = useState(false);
  const ready = labels.every((label) => label.trim());
  const submit = () =>
    write.mutate(
      {
        path: `/tombolas/${tombola.id}/draw`,
        body: {
          ...(nonce.trim() ? { clientNonce: nonce.trim() } : {}),
          prizes: labels.map((label, index) => ({ rank: index + 1, label: label.trim() })),
        },
      },
      { onSettled: () => setConfirming(false) },
    );
  return (
    <section className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <h2 className="text-lg font-semibold">{t('drawTitle')}</h2>
      <label className="block space-y-1 text-sm">
        <span>{t('nonce')}</span>
        <div className="flex gap-2">
          <input
            className={field}
            maxLength={64}
            dir="auto"
            value={nonce}
            onChange={(event) => setNonce(event.target.value)}
          />
          <button type="button" className={button} onClick={() => setNonce(randomPhrase())}>
            {t('generateNonce')}
          </button>
        </div>
        <span className="text-xs text-fg-2">{t('nonceHelp')}</span>
      </label>
      {labels.map((label, index) => (
        <label key={index} className="block space-y-1 text-sm">
          <span>{t('prizeFor', { rank: index + 1 })}</span>
          <input
            className={field}
            maxLength={80}
            dir="auto"
            value={label}
            onChange={(event) =>
              setLabels(labels.map((item, i) => (i === index ? event.target.value : item)))
            }
          />
        </label>
      ))}
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      <button
        type="button"
        className={primary}
        disabled={!ready}
        onClick={() => setConfirming(true)}
      >
        {t('drawButton')}
      </button>
      {confirming && (
        <Modal title={t('confirmTitle')} onClose={() => !write.isPending && setConfirming(false)}>
          <p className="mb-4 text-sm">{t('confirmText')}</p>
          {write.isPending && (
            <p role="status" className="mb-3 animate-pulse text-sm">
              {t('drawing')}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              className={button}
              disabled={write.isPending}
              onClick={() => setConfirming(false)}
            >
              {t('cancel')}
            </button>
            <button type="button" className={primary} disabled={write.isPending} onClick={submit}>
              {t('confirm')}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function UnreachableDialog({ tombolaId, winner, close }) {
  const { t } = usePortalText();
  const write = usePortalWrite();
  const { message } = useApiError(write.error);
  const [reason, setReason] = useState('');
  return (
    <Modal title={t('markUnreachable')} onClose={close}>
      <label className="block space-y-1 text-sm">
        <span>{t('reason')}</span>
        <textarea
          className={field + ' min-h-20 py-2'}
          maxLength={500}
          dir="auto"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {message && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {message}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-3">
        <button type="button" className={button} onClick={close}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className={primary}
          disabled={!reason.trim() || write.isPending}
          onClick={() =>
            write.mutate(
              {
                path: `/tombolas/${tombolaId}/winners/${winner.id}/unreachable`,
                body: { reason: reason.trim() },
              },
              { onSuccess: close },
            )
          }
        >
          {t('confirm')}
        </button>
      </div>
    </Modal>
  );
}

/** Winners and reserves; agency staff also get the delivery follow-up and audited contacts. */
export function WinnersTable({ tombolaId, staff }) {
  const { t, dateTime } = usePortalText();
  const canDeliver = useCan('tombola.deliver') && staff;
  const canContacts = useCan('customer.read_personal') && staff;
  const [personal, setPersonal] = useState(false);
  const [unreachable, setUnreachable] = useState(null);
  const query = usePortalQuery(
    `/tombolas/${tombolaId}/winners`,
    personal ? { personal: 'true' } : undefined,
  );
  const write = usePortalWrite();
  const { message } = useApiError(write.error);
  const rows = query.data ?? [];
  const rowLabel = (row) =>
    row.isReserve
      ? row.servesRank
        ? t('reserveFor', { rank: row.servesRank })
        : t('reserve')
      : row.rank;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{staff ? t('winnersFollowUp') : t('winners')}</h2>
        {canContacts && (
          <button type="button" className={button} onClick={() => setPersonal(!personal)}>
            {t('showContacts')}
          </button>
        )}
      </div>
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-start text-sm">
          <thead className="bg-sunken">
            <tr>
              {['rank', 'entryNumber', 'customer', 'prize', 'delivery'].map((key) => (
                <th key={key} scope="col" className="p-2 text-start">
                  {t(key)}
                </th>
              ))}
              {canDeliver && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <td className="p-2">{rowLabel(row)}</td>
                <td className="p-2 tabular-nums">
                  <bdi>{row.entryNumber}</bdi>
                </td>
                <td className="p-2">
                  <bdi dir="auto">{row.customer?.fullName}</bdi>{' '}
                  <bdi dir="ltr">{row.customer?.phone}</bdi>
                </td>
                <td className="p-2" dir="auto">
                  {row.prizeLabel ?? '—'}
                </td>
                <td className="p-2">
                  {t('delivery.' + row.deliveryStatus)}
                  {row.deliveredAt && <> · {dateTime(row.deliveredAt)}</>}
                  {row.unreachableReason && (
                    <span className="block text-xs text-fg-2" dir="auto">
                      {row.unreachableReason}
                    </span>
                  )}
                </td>
                {canDeliver && (
                  <td className="p-2 text-end">
                    {row.deliveryStatus === 'pending' && (!row.isReserve || row.servesRank) && (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className={button}
                          disabled={write.isPending}
                          onClick={() =>
                            write.mutate({
                              path: `/tombolas/${tombolaId}/winners/${row.id}/delivered`,
                              body: {},
                            })
                          }
                        >
                          {t('markDelivered')}
                        </button>
                        <button
                          type="button"
                          className={button}
                          onClick={() => setUnreachable(row)}
                        >
                          {t('markUnreachable')}
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unreachable && (
        <UnreachableDialog
          tombolaId={tombolaId}
          winner={unreachable}
          close={() => setUnreachable(null)}
        />
      )}
    </section>
  );
}

function Verification({ tombolaId, committedHash }) {
  const { t } = usePortalText();
  const verify = useVerifyDraw(tombolaId, committedHash);
  const download = () => {
    const blob = new Blob([JSON.stringify(verify.data.data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tombola-${tombolaId}-draw.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          disabled={verify.isPending}
          onClick={() => verify.mutate()}
        >
          {t('verify')}
        </button>
        {verify.data && (
          <button type="button" className={button} onClick={download}>
            {t('download')}
          </button>
        )}
      </div>
      {verify.data && (
        <p
          role="status"
          className={
            'rounded-md p-3 text-sm ' +
            (verify.data.result.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')
          }
        >
          {verify.data.result.ok ? '✓ ' + t('verifyOk') : '✗ ' + t('verifyFail')}
        </p>
      )}
      {verify.isError && (
        <p role="alert" className="text-sm text-danger">
          {t('error')}
        </p>
      )}
    </section>
  );
}

export function drawnByText(t, drawnBy) {
  return drawnBy.kind === 'client'
    ? t('drawnByClient', { name: drawnBy.name })
    : t('drawnByAgency');
}

/**
 * One Tombola: rules, the commitment published when registration closed, the draw (client or
 * director), the results and the browser verification. `staff` is the agency view in /app.
 */
export function PortalTombola({ staff = false }) {
  const { id } = useParams();
  const { t, dateTime, number } = usePortalText();
  const canDraw = useCan('tombola.draw');
  const query = usePortalQuery(`/tombolas/${id}`);
  if (query.isPending) return <p role="status">{t('loading')}</p>;
  if (query.isError || !query.data) return <p role="alert">{t('error')}</p>;
  const tombola = query.data;
  const recordPath = staff ? `/app/tombolas/${id}/record` : `/portal/tombolas/${id}/record`;
  return (
    <section className="space-y-6">
      <Link
        className="text-sm underline"
        to={
          staff
            ? `/app/campaigns/${tombola.campaign.id}`
            : `/portal/campaigns/${tombola.campaign.id}`
        }
      >
        {t('back')}
      </Link>
      <header className="space-y-1">
        <p className="text-sm text-fg-2" dir="auto">
          {tombola.campaign.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight" dir="auto">
          {tombola.name}
        </h1>
        <p className="text-sm">{t('tombolaStatus.' + tombola.status)}</p>
      </header>
      <dl className="grid gap-3 rounded-xl border border-line bg-surface p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">{t('rules')}</dt>
          <dd>
            {t(tombola.entryBasis === 'per_unit' ? 'perUnit' : 'perSale', {
              n: tombola.entriesPerBasis,
            })}
            {tombola.maxEntriesPerCustomer && (
              <> · {t('maxEntries', { n: tombola.maxEntriesPerCustomer })}</>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('registrationEnds')}</dt>
          <dd>{dateTime(tombola.registrationEndsAt)}</dd>
        </div>
        <div>
          <dt className="font-medium">
            {t('winners')} / {t('reserves')}
          </dt>
          <dd>
            {number(tombola.winnersCount)} / {number(tombola.reservesCount)}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('entries')}</dt>
          <dd>{number(tombola.entryCount)}</dd>
        </div>
      </dl>
      {tombola.commitment && (
        <section className="space-y-1.5 rounded-lg border border-accent-line bg-surface p-4 text-sm">
          <h2 className="flex items-center gap-2 font-semibold tracking-tight">
            <ShieldCheck aria-hidden="true" size={16} className="text-accent-text" />
            {t('commitment')}
          </h2>
          <p className="text-fg-2">{t('commitmentHelp')}</p>
          <p>
            {t('eligibleEntries')}: <b>{number(tombola.commitment.eligibleCount)}</b> ·{' '}
            {t('committedAt')}: {dateTime(tombola.commitment.committedAt)}
          </p>
          <Hash value={tombola.commitment.entriesHash} />
        </section>
      )}
      {tombola.status === 'closed' && canDraw && <DrawForm tombola={tombola} />}
      {tombola.draw && (
        <>
          <p className="text-sm">
            {t('drawnBy')}: {drawnByText(t, tombola.draw.drawnBy)} · {t('drawnAt')}:{' '}
            {dateTime(tombola.draw.drawnAt)}
          </p>
          <WinnersTable tombolaId={id} staff={staff} />
          <Verification tombolaId={id} committedHash={tombola.commitment?.entriesHash} />
          <Link className={button + ' inline-flex items-center'} to={recordPath}>
            {t('record')}
          </Link>
        </>
      )}
    </section>
  );
}

export const StaffTombola = () => <PortalTombola staff />;
