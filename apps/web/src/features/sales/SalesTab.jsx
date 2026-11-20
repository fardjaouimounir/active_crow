import { saleReason } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
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
          <p>
            {row.workDate} · {row.animateur.fullName} · {row.pointOfSale.name}
          </p>
          <p>
            {row.customer?.fullName} <bdi>{row.customer?.phone}</bdi>
          </p>
          <div>
            <h3 className="font-semibold">{t('sales.products')}</h3>
            <ul>
              {row.items.map((item) => (
                <li key={item.id}>
                  {item.product.name} × {item.quantity}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold">{t('sales.gifts')}</h3>
            <ul>
              {row.entitlements.map((gift) => (
                <li key={gift.id} className="py-1">
                  {gift.stockItem.name} × {gift.quantity} · {gift.promotion.name} ·{' '}
                  {t('sales.status.' + gift.status)}
                  {gift.deliveryMovementId && (
                    <p className="break-all">
                      {t('sales.movement')} <bdi>{gift.deliveryMovementId}</bdi>
                    </p>
                  )}
                  {gift.shortageIssueId && (
                    <Link className="underline" to={'/app/issues/' + gift.shortageIssueId}>
                      {t('sales.issue')}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-semibold">{t('sales.tombola')}</h3>
            <ul>
              {row.tombolaEntries.map((entry) => (
                <li key={entry.id}>
                  {entry.tombola.name} · <bdi>{entry.entryNumber}</bdi> ·{' '}
                  {t('sales.status.' + entry.status)}
                </li>
              ))}
            </ul>
          </div>
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
      <div className="flex flex-wrap gap-2">
        {['sales', ...Object.keys(resources)].map((key) => (
          <button
            key={key}
            className={button}
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
            <div className="flex flex-wrap gap-3">
              {Object.entries(meta.counts).map(([key, value]) => (
                <span key={key}>
                  {t('sales.' + key)} <strong>{value}</strong>
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
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr>
                      {['date', 'animateur', 'point', 'units', 'statusLabel'].map((key) => (
                        <th className="p-2 text-start" key={key}>
                          {t('sales.' + key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t">
                        <td className="p-2">
                          <button className="underline" onClick={() => select(row.id)}>
                            {row.workDate}
                          </button>
                        </td>
                        <td className="p-2">{row.animateur.fullName}</td>
                        <td className="p-2">{row.pointOfSale.name}</td>
                        <td className="p-2">{row.units}</td>
                        <td className="p-2">{t('sales.status.' + row.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </>
      )}
      {view === 'sales' && <Pagination meta={meta} setPage={(page) => setFilters({ page })} />}
      {selected && <SaleDetail id={selected} close={() => select(null)} />}
      <p className="text-sm text-slate-600">{t('sales.interactionHelp')}</p>
    </section>
  );
}
