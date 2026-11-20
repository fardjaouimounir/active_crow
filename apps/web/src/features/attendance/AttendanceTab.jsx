import { absenceInput, attendanceReason, hasAbsenceReason, today } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../shared/auth/hooks.js';
import { useApiError } from '../../shared/ui/useApiError.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { useFileObjectUrl } from '../files/api.js';
import { useIdempotencyKey } from '../inventory/api.js';
import { useBoard, useFieldWrite, useProof } from './api.js';

const tones = {
  not_sent: 'bg-slate-100 text-slate-800',
  pending: 'bg-amber-100 text-amber-900',
  verified: 'bg-green-100 text-green-900',
  rejected: 'bg-red-100 text-red-900',
  absent_justified: 'bg-blue-100 text-blue-900',
  absent_unjustified: 'bg-rose-100 text-rose-900',
};
const flags = ['late', 'far_from_pos', 'low_gps_accuracy', 'pos_without_location'];
export const button = 'rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50';
export const field = 'rounded border border-slate-300 p-2';

export function QueryState({ query }) {
  const { t } = useTranslation('common');
  const { message } = useApiError(query.error);
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (query.isError) return <p role="alert">{message}</p>;
  return null;
}

export function Photo({ id }) {
  const { t } = useTranslation('common');
  const file = useFileObjectUrl(id);
  return file.url ? (
    <img className="max-h-72 rounded object-contain" src={file.url} alt={t('attendance.photo')} />
  ) : (
    <QueryState
      query={{ isPending: file.pending, isError: Boolean(file.error), error: file.error }}
    />
  );
}

export function time(value, locale) {
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'Africa/Algiers',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function Proof({ id, close }) {
  const { t, i18n } = useTranslation('common');
  const proof = useProof(id);
  const write = useFieldWrite();
  const { message } = useApiError(write.error);
  const canReview = useCan('attendance.review');
  const canOverride = useCan('attendance.override');
  const [action, setAction] = useState('');
  const { register, handleSubmit } = useForm({ resolver: zodResolver(attendanceReason) });
  const row = proof.data?.data;
  const submit = ({ reason }) => {
    const body =
      action === 'reject'
        ? { reason }
        : action === 'override'
          ? { note: reason, status: row.status === 'verified' ? 'rejected' : 'verified' }
          : {};
    write.mutate({ path: `/attendance/${id}/${action}`, body }, { onSuccess: close });
  };
  return (
    <Modal drawer title={t('attendance.proof')} onClose={close}>
      <QueryState query={proof} />
      {row && (
        <div className="grid gap-3">
          {row.photoFileId && <Photo id={row.photoFileId} />}
          <p>
            {t('attendance.recordedAt')} {time(row.recordedAt, i18n.language)}
          </p>
          <p>
            {t('attendance.distance', {
              distance: row.distanceM ?? '—',
              accuracy: row.gpsAccuracyM ?? '—',
            })}
          </p>
          <p>{row.flags.map((flag) => t('attendance.flags.' + flag)).join(' · ')}</p>
          {row.latitude != null && row.longitude != null && (
            <a
              target="_blank"
              rel="noreferrer"
              href={`https://www.openstreetmap.org/?mlat=${row.latitude}&mlon=${row.longitude}#map=17/${row.latitude}/${row.longitude}`}
            >
              {t('attendance.map')}
            </a>
          )}
          {row.reviewNote && <p>{row.reviewNote}</p>}
          {row.status === 'pending' && canReview && (
            <div className="flex gap-2">
              <button
                className={button}
                onClick={() =>
                  write.mutate({ path: `/attendance/${id}/verify`, body: {} }, { onSuccess: close })
                }
                disabled={write.isPending}
              >
                {t('attendance.verify')}
              </button>
              <button className={button} onClick={() => setAction('reject')}>
                {t('attendance.reject')}
              </button>
            </div>
          )}
          {row.status !== 'pending' && canOverride && (
            <button className={button} onClick={() => setAction('override')}>
              {t('attendance.override')}
            </button>
          )}
          {action && (
            <form className="grid gap-2" onSubmit={handleSubmit(submit)}>
              <label>
                {t('attendance.reason')}
                <textarea
                  className={field + ' w-full'}
                  required
                  minLength={3}
                  maxLength={300}
                  {...register('reason', { required: true })}
                />
              </label>
              <button className={button} disabled={write.isPending}>
                {t('admin.confirm')}
              </button>
            </form>
          )}
          {row.absences
            ?.filter((item) => item.voidedAt)
            .map((item) => (
              <p key={item.id}>
                {t('attendance.voided')} {item.voidReason}
              </p>
            ))}
          {write.isError && <p role="alert">{message}</p>}
        </div>
      )}
    </Modal>
  );
}

function Absence({ row, date, candidates, close }) {
  const { t } = useTranslation('common');
  const { control, register, handleSubmit } = useForm({
    defaultValues: { type: 'justified' },
    resolver: zodResolver(absenceInput.refine(hasAbsenceReason, { path: ['reason'] })),
  });
  const type = useWatch({ control, name: 'type' });
  const write = useFieldWrite(useIdempotencyKey());
  const { message } = useApiError(write.error);
  return (
    <Modal title={t('attendance.absence')} onClose={close}>
      <form
        className="grid gap-3"
        onSubmit={handleSubmit(({ type, reason, replacementAssignmentId }) =>
          write.mutate(
            {
              path: `/assignments/${row.assignmentId}/absences`,
              body: {
                workDate: date,
                type,
                reason,
                replacementAssignmentId: replacementAssignmentId || undefined,
              },
            },
            { onSuccess: close },
          ),
        )}
      >
        <label>
          {t('attendance.type')}{' '}
          <select className={field} {...register('type')}>
            <option value="justified">{t('attendance.status.absent_justified')}</option>
            <option value="unjustified">{t('attendance.status.absent_unjustified')}</option>
          </select>
        </label>
        <label>
          {t('attendance.reason')}
          <textarea
            className={field + ' w-full'}
            maxLength={300}
            required={type === 'justified'}
            {...register('reason', { setValueAs: (value) => value.trim() || undefined })}
          />
        </label>
        <label>
          {t('attendance.replacement')}{' '}
          <select
            className={field}
            {...register('replacementAssignmentId', { setValueAs: (value) => value || undefined })}
          >
            <option value="">—</option>
            {candidates.map((item) => (
              <option key={item.assignmentId} value={item.assignmentId}>
                {item.animateur.fullName}
              </option>
            ))}
          </select>
        </label>
        {write.isError && <p role="alert">{message}</p>}
        <button className={button} disabled={write.isPending}>
          {t('admin.confirm')}
        </button>
      </form>
    </Modal>
  );
}

function AbsenceHistory({ row, close }) {
  const { t } = useTranslation('common');
  const canVoid = useCan('absence.void');
  const write = useFieldWrite();
  const { message } = useApiError(write.error);
  const { register, handleSubmit } = useForm({ resolver: zodResolver(attendanceReason) });
  const active = row.absenceHistory.find((item) => !item.voidedAt);
  return (
    <Modal title={t('attendance.absenceHistory')} onClose={close}>
      <ul className="grid gap-2">
        {row.absenceHistory.map((item) => (
          <li key={item.id}>
            <p>
              {t('attendance.status.absent_' + item.type)} {item.reason}
            </p>
            {item.voidedAt && (
              <p>
                {t('attendance.voided')} · {item.voidReason}
              </p>
            )}
          </li>
        ))}
      </ul>
      {canVoid && active && (
        <form
          className="mt-4 grid gap-2"
          onSubmit={handleSubmit((body) =>
            write.mutate({ path: `/absences/${active.id}/void`, body }, { onSuccess: close }),
          )}
        >
          <label>
            {t('attendance.reason')}
            <textarea
              className={field + ' w-full'}
              required
              minLength={3}
              maxLength={300}
              {...register('reason')}
            />
          </label>
          {write.isError && <p role="alert">{message}</p>}
          <button className={button} disabled={write.isPending}>
            {t('attendance.voidAbsence')}
          </button>
        </form>
      )}
    </Modal>
  );
}

export function AttendanceTab({ campaign }) {
  const { t, i18n } = useTranslation('common');
  const { filters, setFilters } = useFilters();
  const date = filters.date ?? today();
  const query = useBoard(campaign.id, date);
  const [selected, select] = useState([]);
  const [proof, openProof] = useState(null);
  const [absence, openAbsence] = useState(null);
  const [absenceHistory, openAbsenceHistory] = useState(null);
  const write = useFieldWrite();
  const { message } = useApiError(write.error);
  const canReview = useCan('attendance.review');
  const canRecordAbsence = useCan('absence.record');
  const rows = query.data?.data.rows ?? [];
  const checkpoints = [
    ...new Map(rows.flatMap((row) => row.checkpoints.map((cell) => [cell.code, cell]))).values(),
  ].sort((a, b) => a.window[0].localeCompare(b.window[0]));
  const matches = (cell) =>
    Boolean(cell.status) &&
    (!filters.status || cell.status === filters.status) &&
    (!filters.flag || cell.flags.includes(filters.flag));
  return (
    <section className="grid gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid">
          {t('attendance.date')}
          <input
            className={field}
            type="date"
            value={date}
            onChange={(event) => {
              setFilters({ date: event.target.value || today() });
              select([]);
            }}
          />
        </label>
        <label className="grid">
          {t('attendance.filterStatus')}
          <select
            className={field}
            value={filters.status ?? ''}
            onChange={(event) => setFilters({ status: event.target.value })}
          >
            <option value="">{t('attendance.all')}</option>
            {Object.keys(tones).map((status) => (
              <option key={status} value={status}>
                {t('attendance.status.' + status)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid">
          {t('attendance.filterFlag')}
          <select
            className={field}
            value={filters.flag ?? ''}
            onChange={(event) => setFilters({ flag: event.target.value })}
          >
            <option value="">{t('attendance.all')}</option>
            {flags.map((flag) => (
              <option key={flag} value={flag}>
                {t('attendance.flags.' + flag)}
              </option>
            ))}
          </select>
        </label>
        {canReview && (
          <button
            className={button}
            disabled={!selected.length || write.isPending}
            onClick={() =>
              write.mutate(
                {
                  path: `/campaigns/${campaign.id}/attendance/verify-bulk`,
                  body: { ids: selected },
                },
                { onSuccess: () => select([]) },
              )
            }
          >
            {t('attendance.bulk')} ({selected.length})
          </button>
        )}
      </div>
      {write.isError && <p role="alert">{message}</p>}
      {write.data?.skipped.length > 0 && (
        <p role="status">{t('attendance.skipped', { count: write.data.skipped.length })}</p>
      )}
      <QueryState query={query} />
      {query.isSuccess && (
        <>
          <div aria-label={t('attendance.legend')} className="flex flex-wrap gap-2">
            {Object.entries(tones).map(([status, tone]) => (
              <span key={status} className={tone + ' rounded px-2 py-1 text-sm'}>
                {t('attendance.status.' + status)} {query.data.data.counters[status]}
              </span>
            ))}
            <span className="rounded bg-amber-50 px-2 py-1 text-sm">
              {t('attendance.flags.late')} {query.data.data.counters.late}
            </span>
          </div>
          {rows.some((row) => row.checkpoints.some(matches)) ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-start text-sm">
                <thead>
                  <tr>
                    <th className="sticky start-0 bg-white p-2 text-start">
                      {t('roles.animateur')}
                    </th>
                    {checkpoints.map((cell) => (
                      <th key={cell.code} scope="col" className="p-2">
                        {cell.label[i18n.language] ?? cell.label.en}
                      </th>
                    ))}
                    <th scope="col">{t('attendance.absenceHistory')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((row) => row.checkpoints.some(matches))
                    .map((row) => (
                      <tr key={row.assignmentId} className="border-t border-slate-200">
                        <th
                          scope="row"
                          className="sticky start-0 z-10 min-w-36 bg-white p-2 text-start"
                        >
                          {row.animateur.fullName}
                          <span className="block font-normal">
                            {row.pointOfSale.name} ·{' '}
                            {row.pointOfSale.wilaya?.[i18n.language === 'ar' ? 'nameAr' : 'nameEn']}
                          </span>
                          <span className="block font-normal">{row.supervisor.fullName}</span>
                        </th>
                        {checkpoints
                          .map(
                            ({ code }) =>
                              row.checkpoints.find((cell) => cell.code === code) ?? { code },
                          )
                          .map((cell) => (
                            <td key={cell.code} className="min-w-32 p-2 align-top">
                              {matches(cell) && (
                                <div
                                  className={
                                    tones[cell.status] + ' flex items-start gap-2 rounded p-2'
                                  }
                                >
                                  {canReview && cell.status === 'pending' && (
                                    <input
                                      type="checkbox"
                                      checked={selected.includes(cell.record.id)}
                                      aria-label={t('attendance.select', {
                                        name: row.animateur.fullName,
                                        checkpoint: cell.code,
                                      })}
                                      onChange={(event) =>
                                        select((ids) =>
                                          event.target.checked
                                            ? [...ids, cell.record.id].slice(0, 200)
                                            : ids.filter((id) => id !== cell.record.id),
                                        )
                                      }
                                    />
                                  )}
                                  {cell.record ? (
                                    <button
                                      className="text-start underline"
                                      onClick={() => openProof(cell.record.id)}
                                    >
                                      {t('attendance.status.' + cell.status)}
                                      <br />
                                      {time(cell.record.recordedAt, i18n.language)}
                                    </button>
                                  ) : (
                                    <span>{t('attendance.status.' + cell.status)}</span>
                                  )}
                                  {cell.flags.map((flag) => (
                                    <span
                                      key={flag}
                                      title={t('attendance.flags.' + flag)}
                                      aria-label={t('attendance.flags.' + flag)}
                                    >
                                      ⚑
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                          ))}
                        <td className="p-2">
                          {row.absenceHistory?.length > 0 && (
                            <button className={button} onClick={() => openAbsenceHistory(row)}>
                              {t('attendance.absenceHistory')}
                            </button>
                          )}
                          {canRecordAbsence &&
                            !row.absenceHistory?.some((item) => !item.voidedAt) && (
                              <button className={button} onClick={() => openAbsence(row)}>
                                {t('attendance.absence')}
                              </button>
                            )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{t('attendance.empty')}</p>
          )}
        </>
      )}
      {proof && <Proof id={proof} close={() => openProof(null)} />}
      {absenceHistory && (
        <AbsenceHistory row={absenceHistory} close={() => openAbsenceHistory(null)} />
      )}
      {absence && (
        <Absence
          row={absence}
          date={date}
          close={() => openAbsence(null)}
          candidates={rows.filter(
            (row) =>
              row.assignmentId !== absence.assignmentId &&
              row.pointOfSale.id === absence.pointOfSale.id,
          )}
        />
      )}
    </section>
  );
}
