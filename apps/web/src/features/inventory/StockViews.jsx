import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { CircleCheck, CircleX } from 'lucide-react';
import { Pagination, TableFrame, tableClass } from '../../ui/data.jsx';
import { EmptyState, StatusBadge, Toast } from '../../shared/ui/PageParts.jsx';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useBalances, useMovement, useMovements, useReconciliation } from './api.js';

const tones = {
  posted: 'good',
  confirmed: 'good',
  disputed: 'warn',
  pending: 'warn',
  pending_approval: 'warn',
};

export function MovementStatus({ status }) {
  const { t } = useTranslation('common');
  return (
    <StatusBadge tone={tones[status] ?? 'neutral'}>{t('stock.statuses.' + status)}</StatusBadge>
  );
}

const headStyle = tableClass.th(true);
const numHead = tableClass.th(true, true);
const cellStyle = tableClass.td(true);
const numCell = tableClass.td(true, true);

/** Heat level 0–3 of a quantity relative to the largest cell, as a token-backed tint. */
const HEAT = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3'];
export function heatClass(quantity, max) {
  if (!quantity || quantity <= 0 || !max) return HEAT[0] + ' text-fg-3';
  const ratio = quantity / max;
  return HEAT[ratio <= 0.25 ? 1 : ratio <= 0.6 ? 2 : 3];
}

export function locationName(place, t) {
  return place.fullName ?? t('stock.kinds.' + place.kind);
}

/** Locations × items. The first column stays in view while scrolling sideways. */
export function BalancesMatrix({ data }) {
  const { t, i18n } = useTranslation('common');
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  if (!data.items.length) return <EmptyState />;
  const max = Math.max(
    0,
    ...data.locations.flatMap((row) => data.items.map((item) => row.quantities[item.id] ?? 0)),
  );
  return (
    <TableFrame>
      <div className="overflow-x-auto">
        <table className={tableClass.table}>
          <thead className="bg-sunken">
            <tr>
              <th scope="col" className={headStyle + ' sticky start-0 bg-sunken'}>
                {t('stock.location')}
              </th>
              {data.items.map((item) => (
                <th key={item.id} scope="col" className={numHead}>
                  {item.name}
                </th>
              ))}
              <th scope="col" className={numHead}>
                {t('stock.total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.locations.map((row) => (
              <tr key={row.id} className="border-t border-line">
                <th
                  scope="row"
                  className={cellStyle + ' sticky start-0 bg-surface text-start font-medium'}
                >
                  {locationName(row, t)}
                  {row.role && <small className="block text-fg-3">{t('roles.' + row.role)}</small>}
                </th>
                {data.items.map((item) => (
                  <td
                    key={item.id}
                    className={numCell + ' ' + heatClass(row.quantities[item.id] ?? 0, max)}
                  >
                    {number.format(row.quantities[item.id] ?? 0)}
                  </td>
                ))}
                <td className={numCell + ' font-semibold'}>{number.format(row.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line bg-sunken">
            <tr>
              <th scope="row" className={cellStyle + ' sticky start-0 bg-sunken text-start'}>
                {t('stock.total')}
              </th>
              {data.items.map((item) => (
                <td key={item.id} className={numCell + ' font-semibold'}>
                  {number.format(data.totals.quantities[item.id] ?? 0)}
                </td>
              ))}
              <td className={numCell + ' font-semibold'}>{number.format(data.totals.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </TableFrame>
  );
}

export function MovementDetail({ id, onClose }) {
  const { t, i18n } = useTranslation('common');
  const query = useMovement(id);
  const { message } = useApiError(query.error);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const movement = query.data?.data;
  return (
    <Modal title={t('stock.details')} onClose={onClose}>
      {query.isPending && <p role="status">{t('admin.loading')}</p>}
      <Toast error message={message} />
      {movement && (
        <div className="grid gap-3 text-sm">
          <p>
            <strong>{t('stock.types.' + movement.type)}</strong>{' '}
            <MovementStatus status={movement.status} />
          </p>
          <p>
            {t('stock.from')}: {locationName(movement.from, t)} → {t('stock.to')}:{' '}
            {locationName(movement.to, t)}
          </p>
          <p>
            {movement.createdBy.fullName} · <bdi>{date.format(new Date(movement.createdAt))}</bdi>
          </p>
          {movement.reference && (
            <p>
              {movement.reason ? t('stock.reason') : t('stock.reference')}:{' '}
              <bdi>
                {movement.reason ? t('stock.reasons.' + movement.reason) : movement.reference}
              </bdi>
            </p>
          )}
          {movement.note && <p>{movement.note}</p>}
          {movement.decisionNote && <p>{movement.decisionNote}</p>}
          <ul className="grid gap-1">
            {movement.lines.map((line) => (
              <li key={line.stockItemId}>
                {line.name}: {line.quantity}
                {line.quantityReceived !== null && ` → ${line.quantityReceived}`}
              </li>
            ))}
          </ul>
          {movement.files.map((file) => (
            <Link key={file.id} className="underline" to={'/files/' + file.id}>
              {t('stock.proof')}
            </Link>
          ))}
          <h3 className="font-medium">{t('stock.entries')}</h3>
          <ul className="grid gap-1">
            {movement.entries.map((entry) => (
              <li key={entry.id}>
                {locationName({ fullName: entry.holderName, kind: entry.locationKind }, t)}:{' '}
                <bdi dir="ltr">
                  {entry.quantityDelta > 0 ? '+' : ''}
                  {entry.quantityDelta}
                </bdi>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

export function MovementsView({ campaignId }) {
  const { t, i18n } = useTranslation('common');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const query = useMovements(campaignId, { page, pageSize: 25 });
  const { message } = useApiError(query.error);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'short' });
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (message) return <Toast error message={message} />;
  const rows = query.data.data;
  const { total, pageSize } = query.data.meta;
  if (!rows.length) return <EmptyState />;
  return (
    <>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-start text-sm hover:bg-sunken"
              onClick={() => setOpen(row.id)}
            >
              <strong>{t('stock.types.' + row.type)}</strong>
              <MovementStatus status={row.status} />
              <span>
                {locationName(row.from, t)} → {locationName(row.to, t)}
              </span>
              <span>{row.lines.map((line) => `${line.name} ×${line.quantity}`).join(', ')}</span>
              <bdi className="ms-auto text-fg-3">{date.format(new Date(row.createdAt))}</bdi>
            </button>
          </li>
        ))}
      </ul>
      <Pagination page={page} pages={Math.ceil(total / pageSize)} onPage={setPage} />
      {open && <MovementDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** FR-083: every row explains its balance; a failing check is highlighted. */
export function ReconciliationTable({ report }) {
  const { t, i18n } = useTranslation('common');
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const columns = [
    'received',
    'sent',
    'returned',
    'distributed',
    'adjusted',
    'balance',
    'inTransitFrom',
    'inTransitTo',
  ];
  return (
    <div className="grid gap-4">
      {!report.ok && (
        <Toast
          error
          message={t('stock.reconciliation.failed', {
            count: report.rows.filter((row) => !row.check.ok).length,
          })}
        />
      )}
      <TableFrame>
        <div className="overflow-x-auto">
          <table className={tableClass.table}>
            <thead className="bg-sunken">
              <tr>
                <th scope="col" className={headStyle + ' sticky start-0 bg-sunken'}>
                  {t('stock.holder')}
                </th>
                <th scope="col" className={headStyle}>
                  {t('stock.item')}
                </th>
                {columns.map((column) => (
                  <th key={column} scope="col" className={numHead}>
                    {t('stock.reconciliation.' + column)}
                  </th>
                ))}
                <th scope="col" className={headStyle}>
                  {t('stock.reconciliation.check')}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr
                  key={row.locationId + row.stockItemId}
                  className={'border-t border-line ' + (row.check.ok ? '' : 'bg-danger-soft')}
                >
                  <th
                    scope="row"
                    className={cellStyle + ' sticky start-0 bg-inherit text-start font-medium'}
                  >
                    {locationName(row.holder, t)}
                  </th>
                  <td className={cellStyle}>{row.name}</td>
                  {columns.map((column) => (
                    <td key={column} className={numCell}>
                      {number.format(row[column])}
                    </td>
                  ))}
                  <td
                    className={
                      cellStyle + ' font-medium ' + (row.check.ok ? 'text-success' : 'text-danger')
                    }
                    data-check={row.check.ok ? 'ok' : 'failed'}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {row.check.ok ? (
                        <CircleCheck aria-hidden="true" size={14} />
                      ) : (
                        <CircleX aria-hidden="true" size={14} />
                      )}
                      {row.check.ok
                        ? t('stock.reconciliation.ok')
                        : t('stock.reconciliation.failed', {
                            count: number.format(row.check.difference),
                          })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TableFrame>
      {report.totals && (
        <dl className="grid gap-2 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-5">
          {['stockIn', 'returnedToClient', 'customers', 'losses', 'physical'].map((key) => (
            <div key={key}>
              <dt className="text-fg-2">{t('stock.reconciliation.' + key)}</dt>
              <dd className="tnum text-lg font-semibold">
                {number.format(report.totals.all[key])}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function ReconciliationView({ campaignId }) {
  const { t } = useTranslation('common');
  const query = useReconciliation(campaignId);
  const { message } = useApiError(query.error);
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (message) return <Toast error message={message} />;
  if (!query.data.data.rows.length) return <EmptyState />;
  return <ReconciliationTable report={query.data.data} />;
}

export function BalancesView({ campaignId }) {
  const { t } = useTranslation('common');
  const query = useBalances(campaignId);
  const { message } = useApiError(query.error);
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (message) return <Toast error message={message} />;
  return <BalancesMatrix data={query.data.data} />;
}
