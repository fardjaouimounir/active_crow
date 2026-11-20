import { AI_CAPABILITIES, AI_SUGGESTION_STATUSES } from '@fieldflow/shared';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { EmptyState, PageHeader, StatusBadge, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useAiList, useAiSuggestion, useReview } from './api.js';
import { AiBadge, AiOutput, useAiText } from './AiUi.jsx';
import { buttonClass } from '../../ui/primitives.jsx';

const field = 'min-h-10 w-full rounded-md border border-control bg-surface px-2';
const FILTERS = ['capability', 'status', 'from', 'to'];

function Filters({ params, update }) {
  const { t } = useAiText();
  const select = (name, values, label) => (
    <label className="space-y-1 text-sm">
      <span>{t(name)}</span>
      <select
        className={field}
        value={params.get(name) ?? ''}
        onChange={(e) => update({ [name]: e.target.value })}
      >
        <option value="">{t('all')}</option>
        {values.map((value) => (
          <option key={value} value={value}>
            {label(value)}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {select('capability', AI_CAPABILITIES, (value) => t('capabilityName.' + value))}
      {select('status', AI_SUGGESTION_STATUSES, (value) => t('suggestion.' + value))}
      {['from', 'to'].map((name) => (
        <label key={name} className="space-y-1 text-sm">
          <span>{t(name)}</span>
          <input
            type="date"
            className={field}
            value={params.get(name) ?? ''}
            onChange={(e) => update({ [name]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
}

const tone = { accepted: 'good', pending_review: 'warn', rejected: 'neutral' };

function ReviewList() {
  const { t, dateTime, percent } = useAiText();
  const [params, setParams] = useSearchParams();
  const query = Object.fromEntries(
    FILTERS.filter((key) => params.get(key)).map((key) => [key, params.get(key)]),
  );
  const page = Number(params.get('page') ?? 1);
  const result = useAiList('/ai/suggestions', { ...query, page, pageSize: 25 });
  const update = (patch) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries({ page: '', ...patch }).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key),
      );
      return next;
    });
  const rows = result.data?.data ?? [];
  const meta = result.data?.meta;
  return (
    <section className="space-y-4">
      <PageHeader title={t('reviewTitle')} />
      <p className="text-sm text-fg-2">{t('reviewIntro')}</p>
      <Filters params={params} update={update} />
      {result.isPending && <p role="status">{t('loading')}</p>}
      {result.isError && <p role="alert">{t('loadError')}</p>}
      {result.data && !rows.length && <EmptyState message={t('none')} />}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-start text-sm">
            <thead className="bg-sunken">
              <tr>
                {['capability', 'subject', 'status', 'confidence', 'received'].map((key) => (
                  <th key={key} className="p-3 text-start font-medium">
                    {t(key)}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-line">
                  <td className="p-3">{t('capabilityName.' + row.capability)}</td>
                  <td className="p-3" dir="auto">
                    {row.subjectName ?? '—'}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge tone={tone[row.status]}>
                        {t('suggestion.' + row.status)}
                      </StatusBadge>
                      {row.failure && <StatusBadge tone="warn">{t('failed')}</StatusBadge>}
                      {row.fallback && <StatusBadge>{t('fallback')}</StatusBadge>}
                    </div>
                  </td>
                  <td className="p-3">{percent(row.confidence)}</td>
                  <td className="p-3">{dateTime(row.createdAt)}</td>
                  <td className="p-3">
                    <Link className="underline" to={'/app/ai-review/' + row.id}>
                      {t('open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta && meta.total > meta.pageSize && (
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => update({ page: String(page - 1) })}
          >
            ‹
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            disabled={page * meta.pageSize >= meta.total}
            onClick={() => update({ page: String(page + 1) })}
          >
            ›
          </button>
        </div>
      )}
    </section>
  );
}

function Kpis({ kpis }) {
  const { t, percent, number } = useAiText();
  if (!kpis) return null;
  const rows = [
    ['kpi.attendance', percent(kpis.attendance?.rate)],
    ['kpi.sales', number(kpis.sales?.units)],
    ['kpi.target', percent(kpis.completion?.targetAchievement)],
    ['kpi.gifts', percent(kpis.gifts?.distributionRate)],
  ];
  return (
    <aside className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-semibold">{t('backendKpis')}</h2>
      <p className="text-xs text-fg-2">
        {t('period')}:{' '}
        <bdi dir="ltr">
          {kpis.period?.from} – {kpis.period?.to}
        </bdi>
      </p>
      <dl className="space-y-1 text-sm">
        {rows.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3">
            <dt>{t(key)}</dt>
            <dd className="tnum font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

function ReviewDetail({ id }) {
  const { t, dateTime, percent } = useAiText();
  const suggestion = useAiSuggestion(id);
  const review = useReview();
  const [note, setNote] = useState('');
  const [needNote, setNeedNote] = useState(false);
  const { message } = useApiError(suggestion.error ?? review.error);
  const row = suggestion.data;
  if (suggestion.isPending) return <p role="status">{t('loading')}</p>;
  if (!row) return <Toast error message={message || t('loadError')} />;
  const pending = row.status === 'pending_review';
  const decide = (decision) => {
    if (decision === 'reject' && !note.trim()) return setNeedNote(true);
    setNeedNote(false);
    review.mutate({ id, decision, note: note.trim() });
  };
  return (
    <section className="space-y-4">
      <Link className="text-sm underline" to="/app/ai-review">
        {t('back')}
      </Link>
      <PageHeader title={t('capabilityName.' + row.capability)}>
        <StatusBadge tone={tone[row.status]}>{t('suggestion.' + row.status)}</StatusBadge>
      </PageHeader>
      <p className="text-sm text-fg-2">
        <bdi dir="auto">{row.subjectName ?? '—'}</bdi> · {t('received')} {dateTime(row.createdAt)} ·{' '}
        {t('model')}: <bdi dir="ltr">{row.modelVersion}</bdi>
        {row.fallback && ` (${t('fallback')})`} · {t('confidence')}: {percent(row.confidence)}
      </p>
      <Toast error message={message} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3 rounded-lg border border-dashed border-accent-line bg-accent-soft/30 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <AiBadge />
            <h2 className="font-semibold tracking-tight">{t('aiText')}</h2>
          </div>
          <AiOutput capability={row.capability} output={row.output} labels={row.labels} />
        </div>
        <Kpis kpis={row.kpis} />
      </div>
      {pending ? (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <label className="block space-y-1 text-sm">
            <span>{t('note')}</span>
            <textarea
              className={field + ' min-h-20 py-2'}
              dir="auto"
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {needNote && (
            <p role="alert" className="text-sm text-danger">
              {t('noteRequired')}
            </p>
          )}
          <div className="flex gap-2">
            {!row.failure && (
              <button
                type="button"
                disabled={review.isPending}
                className={buttonClass({ variant: 'primary' })}
                onClick={() => decide('accept')}
              >
                {t('accept')}
              </button>
            )}
            <button
              type="button"
              disabled={review.isPending}
              className={buttonClass({ variant: 'secondary' })}
              onClick={() => decide('reject')}
            >
              {t('reject')}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-fg-2">
          {t('decided')}: {row.reviewedBy?.name ?? '—'} ·{' '}
          {row.reviewedAt ? dateTime(row.reviewedAt) : '—'}
          {row.reviewNote && <bdi dir="auto"> · {row.reviewNote}</bdi>}
        </p>
      )}
    </section>
  );
}

export function AiReviewPage() {
  const { id } = useParams();
  const allowed = useCan('ai.review');
  const { t } = useAiText();
  if (!allowed) return <p role="alert">{t('loadError')}</p>;
  return id ? <ReviewDetail id={id} /> : <ReviewList />;
}
