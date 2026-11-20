import { tombolaInput } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { usePortalText } from '../../surfaces/portal/api.js';
import { ConfirmDialog, Modal } from '../../shared/ui/Dialogs.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { QueryState, button, field } from '../attendance/AttendanceTab.jsx';
import { Pagination } from './SalesTab.jsx';
import { useEntries, useSaleMutation, useSalesView } from './api.js';

const displayTime = (value) =>
  value ? new Date(+new Date(value) + 3_600_000).toISOString().slice(0, 16) : '';
const submitTime = (value) => {
  if (!value) return '';
  const date = new Date(value.length === 16 ? value + '+01:00' : value);
  return Number.isNaN(+date) ? '' : date.toISOString();
};
const numbers = [
  ['entriesPerBasis', 1, 10],
  ['maxEntriesPerCustomer', 1, 1000],
  ['winnersCount', 1, 100],
  ['reservesCount', 0, 100],
];

function Configuration({ id, row, close }) {
  const { t } = useTranslation('common');
  const write = useSaleMutation();
  const { message } = useApiError(write.error);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(
      tombolaInput.refine(
        ({ registrationEndsAt, drawScheduledAt }) =>
          new Date(drawScheduledAt) >= new Date(registrationEndsAt),
        { path: ['drawScheduledAt'] },
      ),
    ),
    defaultValues: {
      name: row?.name ?? '',
      entryBasis: row?.entryBasis ?? 'per_sale',
      entriesPerBasis: row?.entriesPerBasis ?? 1,
      maxEntriesPerCustomer: row?.maxEntriesPerCustomer ?? null,
      requiresPurchase: true,
      registrationEndsAt: row?.registrationEndsAt ?? '',
      drawScheduledAt: row?.drawScheduledAt ?? '',
      winnersCount: row?.winnersCount ?? 1,
      reservesCount: row?.reservesCount ?? 0,
    },
  });
  return (
    <Modal title={t(row ? 'sales.editTombola' : 'sales.newTombola')} onClose={close}>
      <form
        className="grid gap-3"
        onSubmit={handleSubmit((body) =>
          write.mutate(
            {
              path: row ? '/tombolas/' + row.id : `/campaigns/${id}/tombolas`,
              method: row ? 'patch' : 'post',
              body,
            },
            { onSuccess: close },
          ),
        )}
      >
        <label className="grid">
          {t('sales.name')}
          <input className={field} required minLength={2} maxLength={120} {...register('name')} />
        </label>
        <label className="grid">
          {t('sales.entryBasis')}
          <select className={field} {...register('entryBasis')}>
            <option value="per_sale">{t('sales.perSale')}</option>
            <option value="per_unit">{t('sales.perUnit')}</option>
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          {numbers.map(([key, min, max]) => (
            <label className="grid" key={key}>
              {t('sales.' + key)}
              <input
                className={field + ' min-w-0'}
                type="number"
                min={min}
                max={max}
                required={key !== 'maxEntriesPerCustomer'}
                {...register(key, { setValueAs: (value) => (value === '' ? null : Number(value)) })}
              />
            </label>
          ))}
        </div>
        {['registrationEndsAt', 'drawScheduledAt'].map((key) => (
          <label className="grid" key={key}>
            {t('sales.' + key)}
            <input
              className={field}
              type="datetime-local"
              defaultValue={displayTime(row?.[key])}
              required
              {...register(key, { setValueAs: submitTime })}
            />
          </label>
        ))}
        <p className="text-sm text-slate-600">{t('sales.purchaseRequired')}</p>
        {Object.keys(errors).length > 0 && <p role="alert">{t('sales.invalidConfiguration')}</p>}
        {write.isError && <p role="alert">{message}</p>}
        <button className={button} disabled={write.isPending}>
          {t('admin.confirm')}
        </button>
      </form>
    </Modal>
  );
}

function Entries({ tombola, close }) {
  const { t } = useTranslation('common');
  const { filters, setFilters } = useFilters();
  const query = useEntries(tombola.id, {
    status: filters.entryStatus || undefined,
    number: filters.entryNumber || undefined,
    page: filters.page || undefined,
  });
  const rows = query.data?.data ?? [];
  return (
    <Modal drawer title={tombola.name} onClose={close}>
      <div className="mb-3 flex flex-wrap gap-2">
        <label className="grid">
          {t('sales.number')}
          <input
            type="number"
            min={1}
            className={field}
            value={filters.entryNumber ?? ''}
            onChange={(event) => setFilters({ entryNumber: event.target.value })}
          />
        </label>
        <label className="grid">
          {t('attendance.filterStatus')}
          <select
            className={field}
            value={filters.entryStatus ?? ''}
            onChange={(event) => setFilters({ entryStatus: event.target.value })}
          >
            <option value="">{t('attendance.all')}</option>
            {['valid', 'excluded'].map((status) => (
              <option key={status} value={status}>
                {t('sales.status.' + status)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <QueryState query={query} />
      {query.isSuccess &&
        (rows.length ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="py-2">
                <bdi>{row.entryNumber}</bdi> · {t('sales.status.' + row.status)} ·{' '}
                {row.customer?.fullName} <bdi>{row.customer?.phone}</bdi>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('sales.empty')}</p>
        ))}
      <Pagination meta={query.data?.meta} setPage={(page) => setFilters({ page })} />
    </Modal>
  );
}

export function TombolaTab({ campaign }) {
  const { t } = useTranslation('common');
  const canManage = useCan('tombola.manage');
  const canPreview = useCan('file.share_with_client');
  const { t: portal } = usePortalText();
  const query = useSalesView(campaign.id, 'tombolas', true);
  const [config, setConfig] = useState(null);
  const [entries, setEntries] = useState(null);
  const [closing, setClosing] = useState(null);
  const write = useSaleMutation();
  const { message } = useApiError(write.error);
  const editable = canManage && ['draft', 'planning', 'assigned'].includes(campaign.status);
  const rows = query.data?.data ?? [];
  return (
    <section className="grid gap-3">
      {canPreview && (
        <div>
          <Link className="underline" to={`/app/campaigns/${campaign.id}/client-preview`}>
            {portal('openPreview')}
          </Link>
        </div>
      )}
      {editable && (
        <div>
          <button className={button} onClick={() => setConfig({})}>
            {t('sales.newTombola')}
          </button>
        </div>
      )}
      <QueryState query={query} />
      {query.isSuccess &&
        (rows.length ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="grid gap-2 py-3">
                <div>
                  <strong>{row.name}</strong> · {t('sales.status.' + row.status)} ·{' '}
                  {t('sales.entries')} {row.entryCount}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={button} onClick={() => setEntries(row)}>
                    {t('sales.entries')}
                  </button>
                  {editable && row.status === 'open' && row.entryCount === 0 && (
                    <button className={button} onClick={() => setConfig({ row })}>
                      {t('sales.editTombola')}
                    </button>
                  )}
                  {['closed', 'drawn'].includes(row.status) && (
                    <Link className={button} to={'/app/tombolas/' + row.id}>
                      {portal(row.status === 'drawn' ? 'winnersFollowUp' : 'drawOnBehalf')}
                    </Link>
                  )}
                  {canManage && row.status === 'open' && (
                    <button
                      className={button}
                      onClick={() => {
                        write.reset();
                        setClosing(row);
                      }}
                    >
                      {t('sales.closeTombola')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('sales.empty')}</p>
        ))}
      {config && <Configuration id={campaign.id} row={config.row} close={() => setConfig(null)} />}
      {entries && <Entries tombola={entries} close={() => setEntries(null)} />}
      {closing && (
        <ConfirmDialog
          title={t('sales.closeTombola')}
          message={closing.name}
          pending={write.isPending}
          onClose={() => setClosing(null)}
          onConfirm={() =>
            write.mutate(
              { path: '/tombolas/' + closing.id + '/close', body: {} },
              { onSuccess: () => setClosing(null) },
            )
          }
        >
          {write.isError && <p role="alert">{message}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}
