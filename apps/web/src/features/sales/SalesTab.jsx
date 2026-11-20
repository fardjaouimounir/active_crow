import { saleReason } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Gift, PackageCheck, ShoppingBag, Ticket } from 'lucide-react';
import { useCan } from '../../shared/auth/hooks.js';
import { StatusBadge } from '../../shared/ui/PageParts.jsx';
import { TableFrame, Timeline, TimelineStep, tableClass } from '../../ui/data.jsx';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { QueryState, button, field } from '../attendance/AttendanceTab.jsx';
import { useCustomer, useSale, useSaleMutation, useSales, useSalesView } from './api.js';

export function Pagination({ meta, setPage }) {
  const { t } = useTranslation('common');
  if (!meta || meta.total <= meta.pageSize) return null;
  return (
    <div className="flex gap-2">
      <button className={button} disabled={meta.page === 1} onClick={() => setPage(meta.page - 1)}>
        {t('admin.previous')}
      </button>
      <button
        className={button}
        disabled={meta.page * meta.pageSize >= meta.total}
        onClick={() => setPage(meta.page + 1)}
      >
        {t('admin.next')}
      </button>
    </div>
  );
}

function SaleDetail({ id, close }) {
  const { t } = useTranslation('common');
  const sale = useSale(id);
  const row = sale.data?.data;
  const [voiding, setVoiding] = useState(false);
  const canVoid = useCan('sale.void');
  const write = useSaleMutation();
  const { message } = useApiError(write.error);
  const { register, handleSubmit } = useForm({ resolver: zodResolver(saleReason) });
  return (
    <Modal drawer title={t('sales.detail')} onClose={close}>
      <QueryState query={sale} />
      {row && (
        <div className="grid gap-4">
          <header className="space-y-0.5 text-sm">
            <p className="font-medium text-fg">
              <bdi>{row.workDate}</bdi> · {row.animateur.fullName} · {row.pointOfSale.name}
            </p>
            <p className="text-fg-2">
              {row.customer?.fullName} <bdi>{row.customer?.phone}</bdi>
            </p>
          </header>
          <Timeline label={t('sales.detail')}>
            <TimelineStep icon={ShoppingBag} title={t('sales.products')} tone="accent">
              <ul>
                {row.items.map((item) => (
                  <li key={item.id}>
                    {item.product.name} × {item.quantity}
                  </li>
                ))}
              </ul>
            </TimelineStep>
            <TimelineStep icon={Gift} title={t('sales.gifts')} tone="good">
              <ul className="space-y-1">
                {row.entitlements.map((gift) => (
                  <li key={gift.id}>
                    {gift.stockItem.name} × {gift.quantity} · {gift.promotion.name} ·{' '}
                    <StatusBadge tone={gift.status === 'delivered' ? 'good' : 'warn'}>
                      {t('sales.status.' + gift.status)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            </TimelineStep>
            <TimelineStep icon={PackageCheck} title={t('sales.movement')}>
              {row.entitlements.some((gift) => gift.deliveryMovementId || gift.shortageIssueId) ? (
                <ul className="space-y-1">
                  {row.entitlements
                    .filter((gift) => gift.deliveryMovementId || gift.shortageIssueId)
                    .map((gift) => (
                      <li key={gift.id} className="break-all">
                        {gift.stockItem.name}
                        {gift.deliveryMovementId && (
                          <>
                            {' · '}
                            <bdi>{gift.deliveryMovementId}</bdi>
                          </>
                        )}
                        {gift.shortageIssueId && (
                          <Link
                            className="ms-2 text-accent-text underline underline-offset-4"
                            to={'/app/issues/' + gift.shortageIssueId}
                          >
                            {t('sales.issue')}
                          </Link>
                        )}
                      </li>
                    ))}
                </ul>
              ) : (
                <span className="text-fg-3">—</span>
              )}
            </TimelineStep>
            <TimelineStep icon={Ticket} title={t('sales.tombola')} last>
              {row.tombolaEntries.length ? (
                <ul>
                  {row.tombolaEntries.map((entry) => (
                    <li key={entry.id}>
                      {entry.tombola.name} · <bdi>{entry.entryNumber}</bdi> ·{' '}
                      {t('sales.status.' + entry.status)}
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-fg-3">—</span>
              )}
            </TimelineStep>
          </Timeline>
          {row.proofFileId && (
            <Link className="underline" to={'/files/' + row.proofFileId}>
              {t('sales.proof')}
            </Link>
          )}
          {row.voidReason && (
            <p>
              {t('sales.status.voided')} · {row.voidReason}
            </p>
          )}
          {canVoid && row.status === 'recorded' && !voiding && (
            <button className={button} onClick={() => setVoiding(true)}>
              {t('sales.void')}
            </button>
          )}
          {voiding && (
            <form
              className="grid gap-2"
              onSubmit={handleSubmit((body) =>
                write.mutate(
                  { path: '/sales/' + id + '/void', body },
                  { onSuccess: () => setVoiding(false) },
                ),
              )}
            >
              <label className="grid">
                {t('sales.reason')}
                <textarea
                  className={field}
                  {...register('reason')}
                  required
                  minLength={3}
                  maxLength={300}
                />
              </label>
              <button className={button} disabled={write.isPending}>
                {t('admin.confirm')}
              </button>
              {write.isError && <p role="alert">{message}</p>}
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}

function Customers({ query }) {
  const { t } = useTranslation('common');
  const canRead = useCan('customer.read_personal');
  const [selected, select] = useState(null);
  const read = useCustomer(canRead ? selected : null);
  const rows = query.data?.data.customers ?? [];
  return (
    <>
      <QueryState query={query} />
      {query.isSuccess &&
        (rows.length ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li className="flex flex-wrap items-center gap-3 py-2" key={row.id}>
                <span>{row.fullName ?? '—'}</span>
                <bdi>{row.phone ?? '—'}</bdi>
                <span>
                  {t('sales.sales')} {row.sales}
                </span>
                {canRead && (
                  <button className={button} onClick={() => select(row.id)}>
                    {t('sales.customerDetail')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('sales.empty')}</p>
        ))}
      {canRead && selected && (
        <Modal title={t('sales.customerDetail')} onClose={() => select(null)}>
          <QueryState query={read} />
          {read.data && (
            <p>
              {read.data.data.fullName} <bdi>{read.data.data.phone}</bdi>
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

function SaleFilters({ filters, setFilters, campaign, people }) {
  const { t } = useTranslation('common');
  const dimensions = [
    ['animateurId', 'roles.animateur', people?.animateurs ?? []],
    ['supervisorId', 'roles.supervisor', people?.supervisors ?? []],
    [
      'pointOfSaleId',
      'sales.point',
      (campaign.pointsOfSale ?? []).map((row) => row.pointOfSale ?? row),
    ],
    ['productId', 'sales.products', (campaign.products ?? []).map((row) => row.product ?? row)],
  ];
  return (
    <div className="flex flex-wrap items-end gap-2">
      {['from', 'to'].map((key) => (
        <label className="grid" key={key}>
          {t('attendance.' + key)}
          <input
            className={field}
            type="date"
            value={filters[key] ?? ''}
            onChange={(event) => setFilters({ [key]: event.target.value })}
          />
        </label>
      ))}
      {dimensions.map(([key, label, options]) => (
        <label className="grid" key={key}>
          {t(label)}
          <select
            className={field}
            value={filters[key] ?? ''}
            onChange={(event) => setFilters({ [key]: event.target.value })}
          >
            <option value="">{t('attendance.all')}</option>
            {options.map(({ id, name, fullName }) => (
              <option key={id} value={id}>
                {name ?? fullName}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="grid">
        {t('attendance.filterStatus')}
        <select
          className={field}
          value={filters.status ?? ''}
          onChange={(event) => setFilters({ status: event.target.value })}
        >
          <option value="">{t('attendance.all')}</option>
          {['recorded', 'voided'].map((status) => (
            <option key={status} value={status}>
              {t('sales.status.' + status)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={filters.hasUndelivered === 'true'}
          onChange={(event) =>
            setFilters({ hasUndelivered: event.target.checked ? 'true' : undefined })
          }
        />{' '}
        {t('sales.undelivered')}
      </label>
    </div>
  );
}

const resources = {
  review: 'sales/review',
  undelivered: 'entitlements/undelivered',
  customers: 'customers',
};
export function SalesTab({ campaign }) {
  const { t } = useTranslation('common');
  const { filters, setFilters } = useFilters();
  const view = Object.hasOwn(resources, filters.view) ? filters.view : 'sales';
  const [selected, select] = useState(null);
  const queryFilters = Object.fromEntries(
    [
      'from',
      'to',
      'animateurId',
      'supervisorId',
      'pointOfSaleId',
      'productId',
      'status',
      'hasUndelivered',
      'page',
    ].flatMap((key) => (filters[key] ? [[key, filters[key]]] : [])),
  );
  const query = useSales(campaign.id, queryFilters, view === 'sales');
  const secondary = useSalesView(campaign.id, resources[view], view !== 'sales');
  const active = view === 'sales' ? query : secondary;
  const rows = active.data?.data ?? [];
  const meta = query.data?.meta;
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap gap-1">
        {['sales', ...Object.keys(resources)].map((key) => (
          <button
            key={key}
            className={
              button +
              ' aria-pressed:border-accent-line aria-pressed:bg-accent-soft aria-pressed:text-accent-text'
            }
            aria-pressed={key === view}
            onClick={() => setFilters({ view: key })}
          >
            {t('sales.' + key)}
          </button>
        ))}
      </div>
      {view === 'sales' && (
        <>
          <SaleFilters
            campaign={campaign}
            filters={filters}
            setFilters={setFilters}
            people={meta?.filters}
          />
          {meta?.counts && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(meta.counts).map(([key, value]) => (
                <span
                  key={key}
                  className="inline-flex items-baseline gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-fg-2"
                >
                  {t('sales.' + key)} <strong className="tnum text-sm text-fg">{value}</strong>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      {view === 'customers' ? (
        <Customers query={active} />
      ) : (
        <>
          <QueryState query={active} />
          {active.isSuccess &&
            (!rows.length ? (
              <p>{t('sales.empty')}</p>
            ) : view === 'undelivered' ? (
              <ul className="divide-y">
                {rows.map((row) => (
                  <li className="py-2" key={row.animateur.id + row.stockItem.id}>
                    {row.animateur.fullName} · {row.stockItem.name} × {row.quantity}
                  </li>
                ))}
              </ul>
            ) : (
              <TableFrame>
                <div className="overflow-x-auto">
                  <table className={tableClass.table}>
                    <thead className={tableClass.head}>
                      <tr>
                        {['date', 'animateur', 'point', 'units', 'statusLabel'].map((key) => (
                          <th className={tableClass.th(true, key === 'units')} key={key}>
                            {t('sales.' + key)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id} className={tableClass.row()}>
                          <td className={tableClass.td()}>
                            <button
                              className="tnum underline underline-offset-4 hover:text-accent-text"
                              onClick={() => select(row.id)}
                            >
                              {row.workDate}
                            </button>
                          </td>
                          <td className={tableClass.td()}>{row.animateur.fullName}</td>
                          <td className={tableClass.td()}>{row.pointOfSale.name}</td>
                          <td className={tableClass.td(true, true)}>{row.units}</td>
                          <td className={tableClass.td()}>
                            <StatusBadge tone={row.status === 'voided' ? 'bad' : 'neutral'}>
                              {t('sales.status.' + row.status)}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TableFrame>
            ))}
        </>
      )}
      {view === 'sales' && <Pagination meta={meta} setPage={(page) => setFilters({ page })} />}
      {selected && <SaleDetail id={selected} close={() => select(null)} />}
      <p className="text-sm text-fg-2">{t('sales.interactionHelp')}</p>
    </section>
  );
}
