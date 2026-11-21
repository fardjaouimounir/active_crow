import { attendanceReason, today } from '@fieldflow/shared';
import { useQueries } from '@tanstack/react-query';
import { Check, CircleCheck, Clock, MapPinOff, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { apiClient } from '../../shared/api/client.js';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { PageHeader, Toast } from '../../shared/ui/PageParts.jsx';
import { EmptyState } from '../../ui/data.jsx';
import { useFormat } from '../../ui/format.js';
import { Popover } from '../../ui/overlays.jsx';
import { Avatar, Button, SelectControl, Skeleton, buttonClass, cn } from '../../ui/primitives.jsx';
import { Ago, Section, StackedBar, StatusPill } from '../../ui/viz.jsx';
import { useCampaignResource } from '../campaigns/api.js';
import { useFileObjectUrl } from '../files/api.js';
import { addDays } from '../reporting/DashboardParts.jsx';
import { QueryState, time } from './AttendanceTab.jsx';
import { useFieldWrite, useReviewOverview } from './api.js';

const REASONS = ['blurry', 'notAtStore', 'wrongStore'];

/* --------------------------------------------------------------- Campaigns */

function CampaignRows({ overview, onReview }) {
  const { t } = useTranslation('pro');
  const { t: tc } = useTranslation('common');
  const campaigns = overview?.campaigns ?? [];
  return (
    <Section title={t('review.today')} hint={t('review.todayHint')}>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {campaigns.map((item) => {
          const c = item.counters;
          return (
            <li
              key={item.campaignId}
              className="grid gap-3 px-4 py-3.5 lg:grid-cols-[minmax(0,16rem)_1fr_auto] lg:items-center"
            >
              <Link
                title={item.campaignName}
                className="min-w-0 truncate font-medium hover:underline"
                to={`/app/campaigns/${item.campaignId}?tab=field&sub=attendance&date=${overview.date}`}
              >
                <bdi>{item.campaignName}</bdi>
              </Link>
              <StackedBar
                segments={[
                  {
                    key: 'verified',
                    label: tc('attendance.status.verified'),
                    value: c.verified,
                    tone: 'accent',
                  },
                  {
                    key: 'pending',
                    label: tc('attendance.status.pending'),
                    value: c.pending,
                    tone: 'info',
                  },
                  {
                    key: 'rejected',
                    label: tc('attendance.status.rejected'),
                    value: c.rejected,
                    tone: 'bad',
                  },
                  {
                    key: 'absent',
                    label: t('review.absent'),
                    value: (c.absent_justified ?? 0) + (c.absent_unjustified ?? 0),
                    tone: 'warn',
                  },
                  {
                    key: 'not_sent',
                    label: tc('attendance.status.not_sent'),
                    value: c.not_sent,
                    tone: 'muted',
                  },
                ]}
              />
              <div className="flex items-center gap-3 lg:justify-end">
                {c.late > 0 && (
                  <StatusPill tone="warn" icon={Clock}>
                    {tc('attendance.flags.late')} {c.late}
                  </StatusPill>
                )}
                <Button
                  size="sm"
                  variant={c.pending > 0 ? 'secondary' : 'ghost'}
                  disabled={c.pending === 0}
                  onClick={() => onReview(item.campaignId)}
                >
                  {t('review.pendingReview', { n: c.pending })}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ Queue */

function Thumbnail({ id, alt }) {
  const file = useFileObjectUrl(id, 'thumbnail');
  return file.url ? (
    <img src={file.url} alt={alt} className="size-20 shrink-0 rounded-md object-cover" />
  ) : (
    <Skeleton className="size-20 shrink-0" />
  );
}

function RejectMenu({ onReject, disabled, shortcut }) {
  const { t } = useTranslation('pro');
  const [custom, setCustom] = useState('');
  const parsed = attendanceReason.safeParse({ reason: custom.trim() });
  return (
    <Popover
      align="start"
      label={t('review.rejectReason')}
      className="w-72 max-w-[calc(100vw-3rem)] p-2"
      trigger={
        <Button size="sm" disabled={disabled} aria-keyshortcuts={shortcut} data-reject>
          <X aria-hidden="true" size={14} />
          {t('review.reject')}
          <kbd className="ms-1 rounded border border-line px-1 text-2xs text-fg-3">R</kbd>
        </Button>
      }
    >
      {({ close }) => (
        <div className="grid gap-1">
          <p className="px-2 py-1 text-xs font-medium text-fg-3">{t('review.rejectReason')}</p>
          {REASONS.map((key) => (
            <button
              key={key}
              type="button"
              className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), 'justify-start')}
              onClick={() => {
                close();
                onReject(t('review.reasons.' + key));
              }}
            >
              {t('review.reasons.' + key)}
            </button>
          ))}
          <form
            className="mt-1 flex gap-1.5 border-t border-line pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!parsed.success) return;
              close();
              onReject(custom.trim());
            }}
          >
            <input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder={t('review.otherReason')}
              aria-label={t('review.otherReason')}
              className="h-8 min-w-0 flex-1 rounded-md border border-control bg-surface px-2 text-sm"
            />
            <Button type="submit" size="sm" variant="danger" disabled={!parsed.success}>
              {t('review.reject')}
            </Button>
          </form>
        </div>
      )}
    </Popover>
  );
}

function QueueCard({ row, focused, onFocus, onAccept, onReject, pending, canReview }) {
  const { t } = useTranslation('pro');
  const { t: tc, i18n } = useTranslation('common');
  const far = row.flags?.includes('far_from_pos');
  const ref = useRef(null);
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focused]);
  return (
    <li>
      <article
        ref={ref}
        tabIndex={0}
        onFocus={onFocus}
        data-focused={focused ? 'true' : undefined}
        aria-label={`${row.animateur?.fullName} · ${row.storeName}`}
        className={cn(
          'flex gap-3.5 rounded-lg border bg-surface p-3.5 outline-none transition-colors duration-150',
          focused ? 'border-accent-line ring-1 ring-accent-line' : 'border-line',
        )}
      >
        {row.photoFileId ? (
          <Thumbnail id={row.photoFileId} alt={tc('attendance.photo')} />
        ) : (
          <div className="flex size-20 shrink-0 items-center justify-center rounded-md bg-sunken text-fg-3">
            <MapPinOff aria-hidden="true" size={20} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <Avatar name={row.animateur?.fullName} size="sm" />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">
                <bdi>{row.animateur?.fullName}</bdi>
              </p>
              <p className="truncate text-xs text-fg-3">
                <bdi>{row.storeName}</bdi>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone="neutral" icon={Clock}>
              <span className="tnum">{time(row.recordedAt, i18n.language)}</span>
              <span className="text-fg-3">
                · <Ago at={row.recordedAt} />
              </span>
            </StatusPill>
            {row.isLate && (
              <StatusPill tone="warn" icon={Clock}>
                {tc('attendance.flags.late')}
              </StatusPill>
            )}
            {row.distanceM != null && (
              <StatusPill tone={far ? 'bad' : 'good'} icon={far ? MapPinOff : CircleCheck}>
                <bdi dir="ltr" className="tnum">
                  {row.distanceM} m
                </bdi>
                {far && ` · ${tc('attendance.flags.far_from_pos')}`}
              </StatusPill>
            )}
          </div>
          {canReview && (
            <div className="mt-auto flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={focused ? 'primary' : 'secondary'}
                disabled={pending}
                onClick={onAccept}
                aria-keyshortcuts="A"
                data-accept
              >
                <Check aria-hidden="true" size={14} />
                {t('review.accept')}
                <kbd className="ms-1 rounded border border-accent-fg/30 px-1 text-2xs">A</kbd>
              </Button>
              <RejectMenu disabled={pending} onReject={onReject} shortcut="R" />
            </div>
          )}
        </div>
      </article>
    </li>
  );
}

/** Pending check-ins of the last two weeks across the active campaigns, with store and supervisor. */
function useQueue(campaigns, filters) {
  const { user } = useAuth();
  const from = addDays(today(), -13);
  const to = today();
  const lists = useQueries({
    queries: campaigns.map((campaign) => ({
      queryKey: ['campaigns', user?.id, 'review-queue', campaign.id, from, to],
      queryFn: async ({ signal }) => ({
        campaign,
        rows: (
          await apiClient.get(`/campaigns/${campaign.id}/attendance`, {
            params: { status: 'pending', from, to, pageSize: 100, sort: 'recordedAt' },
            signal,
          })
        ).data.data,
        stores: new Map(
          (await apiClient.get(`/campaigns/${campaign.id}`, { signal })).data.data.pointsOfSale.map(
            (entry) => [(entry.pointOfSale ?? entry).id, (entry.pointOfSale ?? entry).name],
          ),
        ),
        supervisors: new Map(
          (
            await apiClient.get(`/campaigns/${campaign.id}/assignments`, {
              params: { status: 'approved', pageSize: 100 },
              signal,
            })
          ).data.data.map((entry) => [entry.animateurId, entry.supervisor]),
        ),
      }),
      refetchInterval: 60_000,
    })),
  });
  const loading = lists.some((list) => list.isPending);
  const error = lists.some((list) => list.isError);
  const rows = lists
    .flatMap((list) =>
      (list.data?.rows ?? []).map((row) => ({
        ...row,
        campaignId: list.data.campaign.id,
        campaignName: list.data.campaign.name,
        storeName: list.data.stores.get(row.pointOfSaleId) ?? '—',
        supervisor: list.data.supervisors.get(row.animateurId),
      })),
    )
    .filter(
      (row) =>
        (!filters.campaign || row.campaignId === filters.campaign) &&
        (!filters.supervisor || row.supervisor?.id === filters.supervisor) &&
        (!filters.flag || row.flags?.includes(filters.flag)),
    )
    // Problems first: far from the store, then late, then the oldest.
    .sort(
      (a, b) =>
        Number(b.flags?.includes('far_from_pos')) - Number(a.flags?.includes('far_from_pos')) ||
        Number(b.isLate) - Number(a.isLate) ||
        a.recordedAt.localeCompare(b.recordedAt),
    );
  const supervisors = (() => {
    const seen = new Map();
    for (const list of lists)
      for (const supervisor of list.data?.supervisors.values() ?? [])
        if (supervisor) seen.set(supervisor.id, supervisor.fullName);
    return [...seen].map(([id, fullName]) => ({ id, fullName }));
  })();
  return { rows, loading, error, supervisors };
}

function ReviewQueue({ campaigns, pending = false }) {
  const { t } = useTranslation('pro');
  const { t: tc } = useTranslation('common');
  const canReview = useCan('attendance.review');
  const { filters, setFilter } = useFilters();
  const { rows, loading, error, supervisors } = useQueue(campaigns, filters);
  const write = useFieldWrite();
  const [done, setDone] = useState(() => new Set());
  const [cursor, setCursor] = useState(0);
  const visible = rows.filter((row) => !done.has(row.id));
  const current = visible[Math.min(cursor, visible.length - 1)];
  const container = useRef(null);

  const [failed, setFailed] = useState(false);
  const resolve = async (row, action, body = {}) => {
    setDone((previous) => new Set(previous).add(row.id));
    setFailed(false);
    try {
      await write.mutateAsync({ path: `/attendance/${row.id}/${action}`, body });
    } catch {
      setFailed(true);
      setDone((previous) => {
        const next = new Set(previous);
        next.delete(row.id);
        return next;
      });
    }
  };

  useEffect(() => {
    const onKey = (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || !canReview || !current)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(
          'input, textarea, select, button, a, dialog, [role=group], [role=dialog], [contenteditable]',
        )
      )
        return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        resolve(current, 'verify');
      } else if (key === 'r') {
        event.preventDefault();
        container.current
          ?.querySelector('[data-focused=true] [data-reject]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      } else if (key === 'arrowright') {
        event.preventDefault();
        setCursor((value) => Math.min(value + 1, visible.length - 1));
      } else if (key === 'arrowleft') {
        event.preventDefault();
        setCursor((value) => Math.max(value - 1, 0));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Section
      title={t('review.queue')}
      hint={t('review.queueHint')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <SelectControl
            aria-label={t('review.campaign')}
            value={filters.campaign ?? ''}
            onChange={(event) => setFilter('campaign', event.target.value)}
            className="h-8 w-44!"
          >
            <option value="">{t('review.allCampaigns')}</option>
            {campaigns.map((campaign) => (
              <option key={campaign.id} value={campaign.id}>
                {campaign.name}
              </option>
            ))}
          </SelectControl>
          <SelectControl
            aria-label={t('review.supervisor')}
            value={filters.supervisor ?? ''}
            onChange={(event) => setFilter('supervisor', event.target.value)}
            className="h-8 w-44!"
          >
            <option value="">{t('review.allSupervisors')}</option>
            {supervisors.map((supervisor) => (
              <option key={supervisor.id} value={supervisor.id}>
                {supervisor.fullName}
              </option>
            ))}
          </SelectControl>
          <SelectControl
            aria-label={t('review.flag')}
            value={filters.flag ?? ''}
            onChange={(event) => setFilter('flag', event.target.value)}
            className="h-8 w-44!"
          >
            <option value="">{t('review.allFlags')}</option>
            {['late', 'far_from_pos', 'low_gps_accuracy'].map((flag) => (
              <option key={flag} value={flag}>
                {tc('attendance.flags.' + flag)}
              </option>
            ))}
          </SelectControl>
        </div>
      }
    >
      <div ref={container}>
        {failed && <Toast error message={t('review.failed')} />}
        {error && <Toast error message={t('review.loadFailed')} />}
        {loading || pending ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {[0, 1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-32 rounded-lg" />
            ))}
          </div>
        ) : error ? null : visible.length ? (
          <>
            <ul className="grid gap-3 xl:grid-cols-2">
              {visible.map((row, index) => (
                <QueueCard
                  key={row.id}
                  row={row}
                  canReview={canReview}
                  focused={row === current}
                  pending={write.isPending}
                  onFocus={() => setCursor(index)}
                  onAccept={() => resolve(row, 'verify')}
                  onReject={(reason) => resolve(row, 'reject', { reason })}
                />
              ))}
            </ul>
            {canReview && (
              <p className="mt-3 text-xs text-fg-3">
                <kbd className="rounded border border-line px-1">A</kbd> {t('review.accept')} ·{' '}
                <kbd className="rounded border border-line px-1">R</kbd> {t('review.reject')} ·{' '}
                <kbd className="rounded border border-line px-1">→</kbd> {t('review.next')}
              </p>
            )}
          </>
        ) : (
          <EmptyState title={t('review.emptyTitle')} message={t('review.empty')} />
        )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------- Page */

export function ReviewPage() {
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
  const { date } = useFormat();
  const allowed = useCan('attendance.review');
  const { setFilter } = useFilters();
  const overview = useReviewOverview(allowed);
  const active = useCampaignResource(
    '/campaigns',
    { status: 'active', pageSize: 20 },
    { enabled: allowed },
  );
  if (!allowed) return <p role="alert">{t('errors.FORBIDDEN')}</p>;
  const daily = overview.data?.data;
  const jumpToQueue = (campaignId) => {
    setFilter('campaign', campaignId);
    document.getElementById('review-queue')?.scrollIntoView({ behavior: 'smooth' });
  };
  return (
    <section className="space-y-6">
      <PageHeader
        title={t('admin.attendance')}
        context={daily ? `${date(daily.date)} · ${tp('review.context')}` : undefined}
      />
      <QueryState query={overview} />
      {daily &&
        (daily.campaigns.length ? (
          <>
            <CampaignRows overview={daily} onReview={jumpToQueue} />
            <div id="review-queue" className="scroll-mt-6">
              <ReviewQueue campaigns={active.data?.data ?? []} pending={active.isPending} />
            </div>
          </>
        ) : (
          <EmptyState title={tp('review.noCampaignsTitle')} message={t('attendance.empty')}>
            <Link className={buttonClass({ variant: 'primary', size: 'sm' })} to="/app/campaigns">
              {tp('field.openCampaigns')}
            </Link>
          </EmptyState>
        ))}
    </section>
  );
}
