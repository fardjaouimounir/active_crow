import {
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  Gift,
  MapPinOff,
  TriangleAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useQueries } from '@tanstack/react-query';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { useCampaignResource } from '../campaigns/api.js';
import { apiClient } from '../../shared/api/client.js';
import { chartAxis, chartGrid, chartTooltip } from '../../ui/chartTheme.js';
import { KpiStrip, KpiTile } from '../../ui/data.jsx';
import { useFormat } from '../../ui/format.js';
import { Avatar, ForwardArrow, buttonClass, cn } from '../../ui/primitives.jsx';
import { Ago, Section, Sparkline, StatusPill, Surface } from '../../ui/viz.jsx';
import { EmptyState } from '../../ui/data.jsx';
import { Toast } from '../../shared/ui/PageParts.jsx';
import { useReport } from './api.js';
import { ReportTable, useReportingText } from './ReportingUi.jsx';

const addDays = (iso, days) => {
  const date = new Date(iso + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
export { addDays };

/* ------------------------------------------------------------- Today strip */

/**
 * Live "right now" strip: updates every minute. Present / late / not sent come from today's
 * attendance, sales and gifts from today's totals, all through the scoped reporting API.
 */
export function TodayStrip({ filters, now }) {
  const { t } = useTranslation('pro');
  const { num, language } = useFormat();
  const query = useReport('/kpis', { ...filters, from: now, to: now }, true, {
    refetchInterval: 60_000,
  });
  const values = query.data;
  const attendance = values?.attendance;
  const submitted = attendance ? attendance.verified + attendance.pending + attendance.rejected : 0;
  const late = attendance?.lateShare != null ? Math.round(attendance.lateShare * submitted) : 0;
  const hasPlan = (attendance?.expectedSlots ?? 0) > 0;
  const stats = [
    { key: 'present', value: hasPlan ? submitted : null, icon: UserCheck },
    { key: 'late', value: hasPlan ? late : null, icon: Clock, warn: late > 0 },
    { key: 'notSent', value: hasPlan ? attendance.notSent : null, icon: CircleAlert },
    { key: 'salesSoFar', value: hasPlan ? values.sales.units : null, icon: ForwardArrow },
    { key: 'giftsDelivered', value: hasPlan ? values.gifts.distributedUnits : null, icon: Gift },
  ];
  const clock = query.dataUpdatedAt
    ? new Intl.DateTimeFormat(language.startsWith('ar') ? 'ar-DZ-u-nu-latn' : 'en-GB', {
        timeZone: 'Africa/Algiers',
        hour: '2-digit',
        minute: '2-digit',
      }).format(query.dataUpdatedAt)
    : '';
  return (
    <Surface className="flex flex-wrap items-stretch" as="section">
      <div className="flex min-w-40 items-center gap-2.5 border-e border-line px-4 py-3">
        <span className="relative flex size-2.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex size-2.5 rounded-full bg-accent" />
        </span>
        <div className="leading-tight">
          <p className="text-sm font-semibold">{t('today.title')}</p>
          <p className="tnum text-2xs text-fg-3">
            {t('today.live')} {clock && `· ${clock}`}
          </p>
        </div>
      </div>
      <dl className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-5">
        {stats.map(({ key, value, icon: Icon, warn }) => (
          <div
            key={key}
            className="flex items-center gap-2.5 border-s border-line px-4 py-3 first:border-s-0 max-sm:border-t"
          >
            <Icon
              aria-hidden="true"
              size={16}
              strokeWidth={1.5}
              className={cn('shrink-0', warn ? 'text-warning' : 'text-fg-3')}
            />
            <div className="min-w-0 leading-tight">
              <dd className="tnum text-lg font-semibold">{num(value)}</dd>
              <dt className="truncate text-2xs text-fg-3">{t('today.' + key)}</dt>
            </div>
          </div>
        ))}
      </dl>
    </Surface>
  );
}

/* ------------------------------------------------------------------ KPI row */

/**
 * KPI strip with a hero tile, 14-day sparklines, delta vs the previous period and a thin progress
 * bar where a target exists. `trend` holds the last 14 daily rows (unfiltered by period).
 */
export function KpiRow({ values, trend, supervisor = false, compare = true }) {
  const { t } = useTranslation('pro');
  const { num, pct } = useFormat();
  const days = [...(trend ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const series = (pick) => (days.length > 1 ? days.map(pick) : null);
  const prev = values.previous;
  const target = values.completion?.salesTarget;
  const delta = (group, field) => {
    const a = values[group]?.[field];
    const b = prev?.[group]?.[field];
    return !compare || supervisor || a == null || b == null ? null : a - b;
  };
  const tiles = [
    {
      key: 'sales',
      hero: true,
      value: values.sales.units,
      format: (n) => num(n),
      delta: delta('sales', 'units'),
      deltaFormat: (n) => num(n),
      spark: series((row) => row.sales.units),
    },
    {
      key: 'attendance',
      value: values.attendance.expectedSlots ? values.attendance.rate : null,
      format: (n) => pct(n),
      delta: delta('attendance', 'rate'),
      deltaFormat: (n) => pct(n),
      spark: series((row) => row.attendance.rate),
    },
    {
      key: 'buyers',
      value: values.customers.buyers,
      format: (n) => num(n),
      delta: delta('customers', 'buyers'),
      deltaFormat: (n) => num(n),
      spark: series((row) => row.customers.buyers),
    },
    {
      key: 'gifts',
      value: values.gifts.distributionRate,
      format: (n) => pct(n),
      delta: delta('gifts', 'distributionRate'),
      deltaFormat: (n) => pct(n),
    },
    {
      key: 'reach',
      value: values.customers.reach,
      format: (n) => num(n),
      delta: delta('customers', 'reach'),
      deltaFormat: (n) => num(n),
    },
    {
      key: 'visits',
      value: values.visits.count,
      format: (n) => num(n),
      delta: delta('visits', 'count'),
      deltaFormat: (n) => num(n),
      spark: series((row) => row.visits.count),
    },
    {
      key: 'target',
      value: target ? values.completion.targetAchievement : null,
      format: (n) => pct(n),
      delta: delta('completion', 'targetAchievement'),
      deltaFormat: (n) => pct(n),
      progress: target
        ? {
            value: values.completion.targetAchievement,
            max: 1,
            label: t('kpi.target'),
            caption: t('kpi.targetOf', { value: num(target) }),
          }
        : null,
    },
  ];
  return (
    <KpiStrip className="[&>dl]:lg:grid-cols-4">
      {tiles.map((tile) => (
        <KpiTile
          key={tile.key}
          label={t('kpi.' + tile.key)}
          hero={tile.hero}
          value={tile.value}
          format={tile.format}
          delta={tile.delta}
          deltaFormat={tile.deltaFormat}
          deltaGood
          period={tile.delta != null ? t('kpi.vsPrevious') : undefined}
          progress={tile.progress ?? undefined}
          sparkline={
            tile.spark ? <Sparkline values={tile.spark} label={t('kpi.trend14')} /> : undefined
          }
        />
      ))}
    </KpiStrip>
  );
}

/* ------------------------------------------------------------ Sales chart */

/** Daily sales as an area with the previous period as a dashed ghost line. */
export function SalesAreaChart({ rows, previousRows }) {
  const { t } = useTranslation('pro');
  const { t: report } = useReportingText();
  const { num, rtl } = useFormat();
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const before = [...(previousRows ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  const data = sorted.map((row, index) => ({
    id: row.id,
    sales: row.sales.units,
    previous: before[index]?.sales.units ?? null,
  }));
  return (
    <Surface className="min-w-0 p-4" as="section">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">{t('charts.sales')}</h2>
        <ul className="flex items-center gap-3 text-2xs text-fg-3">
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-3 rounded bg-accent" />
            {t('charts.current')}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0 w-3 border-t border-dashed border-fg-3" />
            {t('charts.previous')}
          </li>
        </ul>
      </div>
      <div role="img" aria-label={t('charts.sales')} className="h-60" dir="ltr">
        <ResponsiveContainer
          width="100%"
          height="100%"
          initialDimension={{ width: 320, height: 240 }}
        >
          <AreaChart
            data={data}
            accessibilityLayer
            margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
          >
            <defs>
              <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--chart-1)" stopOpacity={0.3} />
                <stop offset="1" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...chartGrid} />
            <XAxis
              {...chartAxis}
              dataKey="id"
              interval="preserveStartEnd"
              padding={{ left: 12, right: 12 }}
              tickFormatter={(value) => value.slice(5)}
            />
            <YAxis
              {...chartAxis}
              orientation={rtl ? 'right' : 'left'}
              allowDecimals={false}
              width={36}
              tickFormatter={(value) => num(value)}
            />
            <ChartTooltip {...chartTooltip} formatter={(value) => num(value)} />
            <Line
              dataKey="previous"
              name={t('charts.previous')}
              stroke="var(--chart-4)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
            <Area
              dataKey="sales"
              name={t('charts.current')}
              type="monotone"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              fill="url(#salesFill)"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm text-fg-2">{report('viewData')}</summary>
        <ReportTable
          rows={data}
          columns={[
            ['label', (row) => row.id],
            ['sales', (row) => num(row.sales)],
          ]}
        />
      </details>
    </Surface>
  );
}

/* ---------------------------------------------------------- Needs attention */

const SEVERITY = {
  critical: { tone: 'bad', icon: CircleX, rank: 0 },
  warning: { tone: 'warn', icon: TriangleAlert, rank: 1 },
  info: { tone: 'info', icon: CircleAlert, rank: 2 },
};

/**
 * Real, actionable items instead of a table of counters: what, where, since when and a button to
 * act. Items with nothing to report are not shown; with none left the list says "all clear".
 */
export function AttentionList({ values, supervisor }) {
  const { t } = useTranslation('pro');
  const { num } = useFormat();
  const canIssues = useCan('issue.read');
  const canApprove = useCan('assignment.approve');
  const canReview = useCan('attendance.review');
  const issues = useCampaignResource(
    '/issues',
    { status: 'open', page: 1, pageSize: 4 },
    { enabled: canIssues },
  );
  const pending = useCampaignResource(
    '/assignments/pending',
    { page: 1, pageSize: 1 },
    { enabled: canApprove },
  );
  const review = useCampaignResource('/me/attendance/review', undefined, { enabled: canReview });
  const items = [];

  for (const campaign of review.data?.data?.campaigns ?? []) {
    const count = campaign.counters?.pending ?? 0;
    if (count > 0)
      items.push({
        key: 'review-' + campaign.campaignId,
        severity: count >= 10 ? 'critical' : 'warning',
        title: t('attention.review', { n: num(count) }),
        where: campaign.campaignName,
        since: campaign.pending?.[0]?.recordedAt,
        to: '/app/attendance',
        action: t('attention.reviewAction'),
      });
  }
  if (pending.data?.meta?.total > 0)
    items.push({
      key: 'approvals',
      severity: 'warning',
      title: t('attention.approvals', {
        count: pending.data.meta.total,
        n: num(pending.data.meta.total),
      }),
      where: t('attention.allCampaigns'),
      since: pending.data.data?.[0]?.createdAt,
      to: '/app/approvals',
      action: t('attention.approvalsAction'),
    });
  for (const issue of issues.data?.data ?? [])
    items.push({
      key: 'issue-' + issue.id,
      severity: issue.category === 'stock_shortage' ? 'critical' : 'warning',
      title: issue.title,
      where: [issue.pointOfSale?.name, issue.campaign?.name].filter(Boolean).join(' · '),
      since: issue.createdAt,
      to: '/app/issues/' + issue.id,
      action: t('attention.issueAction'),
    });
  if (values.gifts.undeliveredUnits > 0)
    items.push({
      key: 'gifts',
      severity: 'warning',
      title: t('attention.gifts', { n: num(values.gifts.undeliveredUnits) }),
      where: t('attention.allCampaigns'),
      to: '/app/campaigns',
      action: t('attention.giftsAction'),
    });
  if (values.stock?.failingChecks > 0)
    items.push({
      key: 'stock',
      severity: 'critical',
      title: t('attention.stock', { n: num(values.stock.failingChecks) }),
      where: t('attention.allCampaigns'),
      to: '/app/campaigns',
      action: t('attention.stockAction'),
    });
  const unvisited = values.alerts?.unvisitedStores ?? 0;
  if (!supervisor && unvisited > 0)
    items.push({
      key: 'unvisited',
      severity: 'info',
      title: t('attention.unvisited', { n: num(unvisited) }),
      where: t('attention.allCampaigns'),
      to: '#geography',
      action: t('attention.unvisitedAction'),
      icon: MapPinOff,
    });
  items.sort((a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank);

  return (
    <Section
      title={t('attention.title')}
      hint={items.length ? t('attention.count', { n: items.length }) : undefined}
    >
      {items.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {items.map((item) => {
            const { tone, icon: SevIcon } = SEVERITY[item.severity];
            const Icon = item.icon ?? SevIcon;
            return (
              <li key={item.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <StatusPill tone={tone} icon={Icon} className="w-24 justify-center">
                  {t('attention.severity.' + item.severity)}
                </StatusPill>
                <div className="min-w-0 flex-1 basis-60">
                  <p className="truncate text-sm font-medium text-fg" title={item.title}>
                    <bdi>{item.title}</bdi>
                  </p>
                  <p className="truncate text-xs text-fg-3" title={item.where}>
                    <bdi>{item.where}</bdi>
                  </p>
                </div>
                {item.since && (
                  <span className="text-xs text-fg-3">
                    {t('attention.since')} <Ago at={item.since} />
                  </span>
                )}
                {item.to.startsWith('#') ? (
                  <a className={buttonClass({ size: 'sm' })} href={item.to}>
                    {item.action}
                  </a>
                ) : (
                  <Link className={buttonClass({ size: 'sm' })} to={item.to}>
                    {item.action}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title={t('attention.clearTitle')} message={t('attention.clear')} />
      )}
    </Section>
  );
}

/* ----------------------------------------------- Supervisor: today in the field */

/** Algiers wall-clock time as HH:MM, to tell a window that has closed from one that is still ahead. */
const algiersNow = () =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Algiers',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());

/** A checkpoint nobody sent although its window has closed. */
const overdue = (checkpoint) =>
  checkpoint.status === 'not_sent' &&
  Array.isArray(checkpoint.window) &&
  checkpoint.window[1] <= algiersNow();

/** Problem score used to list the stores that need the supervisor first. */
function trouble(row) {
  return row.checkpoints.reduce(
    (score, checkpoint) =>
      score +
      (checkpoint.status === 'rejected' ? 3 : 0) +
      (checkpoint.isLate ? 1 : 0) +
      (overdue(checkpoint) ? 2 : 0) +
      (checkpoint.flags?.includes('far_from_pos') ? 2 : 0),
    0,
  );
}

const CHECKPOINT_PILL = {
  verified: { tone: 'good', icon: CircleCheck },
  pending: { tone: 'info', icon: Clock },
  rejected: { tone: 'bad', icon: CircleX },
  not_sent: { tone: 'neutral', icon: Clock },
  absent_justified: { tone: 'neutral', icon: Users },
  absent_unjustified: { tone: 'warn', icon: TriangleAlert },
};

function FieldRow({ row, sales, rtl, t }) {
  const { num } = useFormat();
  return (
    <li
      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
      data-trouble={trouble(row)}
    >
      <Avatar name={row.animateur.fullName} />
      <div className="min-w-0 flex-1 basis-56">
        <p className="truncate text-sm font-medium">
          <bdi>{row.animateur.fullName}</bdi>
        </p>
        <p className="truncate text-xs text-fg-3">
          <bdi>
            {(rtl && row.pointOfSale.wilaya?.nameAr) || row.pointOfSale.wilaya?.nameEn} ·{' '}
            {row.pointOfSale.name}
          </bdi>
        </p>
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {row.checkpoints.map((checkpoint) => {
          const spec = CHECKPOINT_PILL[checkpoint.status] ?? CHECKPOINT_PILL.not_sent;
          const label = (rtl ? checkpoint.label?.ar : checkpoint.label?.en) ?? checkpoint.code;
          return (
            <li key={checkpoint.code}>
              <StatusPill
                tone={checkpoint.isLate || overdue(checkpoint) ? 'warn' : spec.tone}
                icon={spec.icon}
              >
                {label}
                {checkpoint.isLate ? ` · ${t('field.late')}` : ''}
              </StatusPill>
            </li>
          );
        })}
      </ul>
      <div className="w-20 text-end">
        <p className="tnum text-sm font-semibold">{num(sales)}</p>
        <p className="text-2xs text-fg-3">{t('field.sales')}</p>
      </div>
    </li>
  );
}

/** Supervisor home: their stores today, problems first, with each Animateur's checkpoints and sales. */
export function SupervisorToday({ date }) {
  const { t } = useTranslation('pro');
  const campaigns = useCampaignResource('/campaigns', { status: 'active', pageSize: 20 });
  const sales = useReport('/breakdown', { from: date, to: date, dimension: 'animateur' });
  const salesByAnimateur = new Map((sales.data ?? []).map((row) => [row.id, row.sales.units]));
  const active = campaigns.data?.data ?? [];
  return (
    <Section title={t('field.title')} hint={t('field.hint')}>
      {campaigns.isPending ? (
        <Surface className="p-6 text-sm text-fg-3" as="div">
          …
        </Surface>
      ) : active.length ? (
        <FieldList campaigns={active} date={date} salesByAnimateur={salesByAnimateur} />
      ) : (
        <EmptyState title={t('field.emptyTitle')} message={t('field.empty')}>
          <Link className={buttonClass({ variant: 'primary', size: 'sm' })} to="/app/campaigns">
            {t('field.openCampaigns')}
          </Link>
        </EmptyState>
      )}
    </Section>
  );
}

function FieldList({ campaigns, date, salesByAnimateur }) {
  const { t } = useTranslation('pro');
  const { rtl } = useFormat();
  const { user } = useAuth();
  const boards = useQueries({
    queries: campaigns.map((campaign) => ({
      queryKey: ['campaigns', user?.id, `/campaigns/${campaign.id}/attendance/board`, { date }],
      queryFn: async ({ signal }) =>
        (
          await apiClient.get(`/campaigns/${campaign.id}/attendance/board`, {
            params: { date },
            signal,
          })
        ).data,
      refetchInterval: 60_000,
    })),
  });
  const rows = boards
    .flatMap((board) => board.data?.data?.rows ?? [])
    .sort(
      (a, b) =>
        trouble(b) - trouble(a) ||
        (salesByAnimateur.get(b.animateur.id) ?? 0) - (salesByAnimateur.get(a.animateur.id) ?? 0) ||
        a.animateur.id.localeCompare(b.animateur.id),
    );
  if (boards.some((board) => board.isPending))
    return <Surface className="p-6 text-sm text-fg-3">…</Surface>;
  if (boards.some((board) => board.isError)) return <Toast error message={t('field.loadFailed')} />;
  if (!rows.length) return <EmptyState title={t('field.emptyTitle')} message={t('field.empty')} />;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {rows.map((row) => (
        <FieldRow
          key={row.assignmentId}
          row={row}
          sales={salesByAnimateur.get(row.animateur.id)}
          rtl={rtl}
          t={t}
        />
      ))}
    </ul>
  );
}

export { trouble };
