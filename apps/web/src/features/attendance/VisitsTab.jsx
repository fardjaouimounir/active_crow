import { issueCategories, visitInput } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useCan } from '../../shared/auth/hooks.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { useIdempotencyKey } from '../inventory/api.js';
import { Photo, QueryState, button, field, time } from './AttendanceTab.jsx';
import { useFieldWrite, useVisit, useVisitOptions, useVisits } from './api.js';

function Preview({ file }) {
  const preview = useRef(null);
  useEffect(() => {
    const next = URL.createObjectURL(file);
    preview.current.src = next;
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return <img ref={preview} className="size-20 rounded object-cover" alt={file.name} />;
}

function NewVisit({ campaignId, close }) {
  const { t } = useTranslation('common');
  const options = useVisitOptions(campaignId);
  const write = useFieldWrite(useIdempotencyKey());
  const { message } = useApiError(write.error);
  const { control, register, setValue, handleSubmit } = useForm({
    defaultValues: { issues: [], observedAnimateurIds: [], pointOfSaleId: '' },
    resolver: zodResolver(
      visitInput.extend({
        photos: z.custom((value) => value?.length >= 1 && value.length <= 5),
        observedAnimateurIds: z.preprocess(
          (value) => (typeof value === 'string' ? [value] : value || []),
          visitInput.shape.observedAnimateurIds,
        ),
      }),
    ),
  });
  const issues = useFieldArray({ control, name: 'issues' });
  const pointOfSaleId = useWatch({ control, name: 'pointOfSaleId' });
  const photos = Array.from(useWatch({ control, name: 'photos' }) ?? []);
  const point = options.data?.data.find(({ id }) => id === pointOfSaleId);
  const categories = issueCategories;
  return (
    <Modal title={t('attendance.newVisit')} onClose={close}>
      <QueryState query={options} />
      {options.isSuccess && (
        <form
          onSubmit={handleSubmit(({ photos: files, ...body }) =>
            write.mutate(
              { path: `/campaigns/${campaignId}/visits`, body, photos: Array.from(files) },
              { onSuccess: close },
            ),
          )}
          className="grid gap-3"
        >
          <label className="grid">
            {t('attendance.point')}
            <select
              className={field}
              required
              {...register('pointOfSaleId', {
                onChange: () => setValue('observedAnimateurIds', []),
              })}
            >
              <option value="">—</option>
              {options.data.data.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend>{t('attendance.observed')}</legend>
            {point?.animateurs.map((person) => (
              <label className="block" key={person.id}>
                <input type="checkbox" value={person.id} {...register('observedAnimateurIds')} />{' '}
                {person.fullName}
              </label>
            ))}
          </fieldset>
          <label className="grid">
            {t('attendance.notes')}
            <textarea className={field} maxLength={1000} {...register('notes')} />
          </label>
          <label className="grid">
            {t('attendance.photos')}
            <input
              type="file"
              multiple
              required
              accept="image/jpeg,image/png,image/webp"
              {...register('photos')}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {photos.slice(0, 5).map((file, index) => (
              <Preview key={file.name + index} file={file} />
            ))}
          </div>
          {photos.length > 5 && <p role="alert">{t('attendance.photoLimit')}</p>}
          {issues.fields.map((issue, index) => (
            <fieldset className="grid gap-2 rounded border p-2" key={issue.id}>
              <legend>{t('attendance.issue')}</legend>
              <label className="grid">
                {t('attendance.category')}
                <select className={field} {...register(`issues.${index}.category`)}>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {t('issues.categories.' + category)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid">
                {t('attendance.title')}
                <input
                  className={field}
                  minLength={3}
                  maxLength={120}
                  required
                  {...register(`issues.${index}.title`)}
                />
              </label>
              <label className="grid">
                {t('attendance.description')}
                <textarea
                  className={field}
                  maxLength={2000}
                  {...register(`issues.${index}.description`)}
                />
              </label>
              <button type="button" className={button} onClick={() => issues.remove(index)}>
                {t('attendance.removeIssue')}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className={button}
            disabled={issues.fields.length === 5}
            onClick={() => issues.append({ category: categories[0], title: '', description: '' })}
          >
            {t('attendance.addIssue')}
          </button>
          {write.isError && <p role="alert">{message}</p>}
          <button className={button} disabled={write.isPending || photos.length > 5}>
            {t('admin.confirm')}
          </button>
        </form>
      )}
    </Modal>
  );
}

function VisitDetail({ id, close }) {
  const { t, i18n } = useTranslation('common');
  const query = useVisit(id);
  const row = query.data?.data;
  return (
    <Modal drawer title={t('attendance.visitDetail')} onClose={close}>
      <QueryState query={query} />
      {row && (
        <div className="grid gap-3">
          <p>
            {row.pointOfSale.name} · {time(row.visitedAt, i18n.language)}
          </p>
          <p>{row.supervisor.fullName}</p>
          <p>{row.notes}</p>
          <p>
            {t('attendance.observed')}{' '}
            {row.observedAnimateurs.map((person) => person.fullName).join(' · ')}
          </p>
          {row.photos.map(({ fileId }) => (
            <Photo key={fileId} id={fileId} />
          ))}
          {row.issues.map((issue) => (
            <Link key={issue.id} to={`/app/issues/${issue.id}`}>
              {issue.title}
            </Link>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function VisitsTab({ campaign }) {
  const { t, i18n } = useTranslation('common');
  const { filters, setFilters } = useFilters();
  const canRecord = useCan('visit.record');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState(null);
  const dateRange = {
    from: filters.from || undefined,
    to: filters.to || undefined,
  };
  const filterOptions = useVisits(campaign.id, dateRange);
  const filtered = Boolean(
    filters.supervisorId || filters.pointOfSaleId || Number(filters.page) > 1,
  );
  const page = useVisits(
    campaign.id,
    {
      ...dateRange,
      supervisorId: filters.supervisorId || undefined,
      pointOfSaleId: filters.pointOfSaleId || undefined,
      page: filters.page,
    },
    filtered,
  );
  const query = filtered ? page : filterOptions;
  const data = filterOptions.data?.data ?? [];
  const { data: rows = [], meta } = query.data ?? {};
  return (
    <section className="grid gap-4">
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
        {[
          ['supervisor', 'roles.supervisor'],
          ['pointOfSale', 'attendance.point'],
        ].map(([key, label]) => (
          <label className="grid" key={key}>
            {t(label)}
            <select
              className={field}
              value={filters[key + 'Id'] ?? ''}
              onChange={(event) => setFilters({ [key + 'Id']: event.target.value })}
            >
              <option value="">{t('attendance.all')}</option>
              {[...new Map(data.map((row) => [row[key].id, row[key]])).values()].map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name ?? item.fullName}
                </option>
              ))}
            </select>
          </label>
        ))}
        {canRecord && campaign.status === 'active' && (
          <button className={button} onClick={() => setCreating(true)}>
            {t('attendance.newVisit')}
          </button>
        )}
      </div>
      <QueryState query={query} />
      {query.isSuccess &&
        (rows.length ? (
          <ul className="divide-y divide-slate-200">
            {rows.map((row) => (
              <li key={row.id} className="py-2">
                <button className="text-start underline" onClick={() => setDetail(row.id)}>
                  {row.pointOfSale.name} · {row.supervisor.fullName} ·{' '}
                  {new Intl.DateTimeFormat(i18n.language, { timeZone: 'Africa/Algiers' }).format(
                    new Date(row.visitedAt),
                  )}{' '}
                  {time(row.visitedAt, i18n.language)}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t('attendance.noVisits')}</p>
        ))}
      {meta && meta.total > meta.pageSize && (
        <div className="flex gap-2">
          <button
            className={button}
            disabled={meta.page <= 1}
            onClick={() => setFilters({ page: meta.page - 1 })}
          >
            {t('admin.previous')}
          </button>
          <button
            className={button}
            disabled={meta.page * meta.pageSize >= meta.total}
            onClick={() => setFilters({ page: meta.page + 1 })}
          >
            {t('admin.next')}
          </button>
        </div>
      )}
      {creating && <NewVisit campaignId={campaign.id} close={() => setCreating(false)} />}
      {detail && <VisitDetail id={detail} close={() => setDetail(null)} />}
    </section>
  );
}
