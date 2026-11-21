import { today as businessToday } from '@fieldflow/shared';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Gift,
  MapPin,
  Package,
  ShoppingBag,
} from 'lucide-react';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { EmptyState } from '../../../ui/data.jsx';
import { useFormat } from '../../../ui/format.js';
import { Avatar, Skeleton, buttonClass, cn } from '../../../ui/primitives.jsx';
import { Ago, ProgressBar, Section, StackedBar, Surface } from '../../../ui/viz.jsx';
import { useReport } from '../../reporting/api.js';
import { KpiRow, addDays } from '../../reporting/DashboardParts.jsx';
import { useWilayas } from '../../organization/api.js';
import { areaOptions } from '../../organization/components/Fields.jsx';
import { useCampaignResource, useReadiness } from '../api.js';
import { BlockerList } from './LifecyclePanel.jsx';

const StoreMap = lazy(() =>
  import('../../../ui/map/StoreMap.jsx').then((module) => ({ default: module.StoreMap })),
);

const DAY = 86_400_000;
const dayNumber = (iso) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / DAY);

/* --------------------------------------------------------------- Progress */

function ProgressPanel({ campaign, values }) {
  const { t } = useTranslation('pro');
  const { pct, num } = useFormat();
  const start = dayNumber(campaign.startDate);
  const end = dayNumber(campaign.endDate);
  const now = dayNumber(businessToday());
  const total = end - start + 1;
  const elapsed = Math.max(0, Math.min(total, now - start + 1));
  const target = values?.completion?.targetAchievement;
  const salesTarget = values?.completion?.salesTarget;
  return (
    <Surface className="grid gap-5 p-4 sm:grid-cols-2" as="section">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('campaign.progressTime')}</h2>
          <span className="tnum text-sm text-fg-2">{pct(elapsed / total)}</span>
        </div>
        <ProgressBar value={elapsed} max={total} label={t('campaign.progressTime')} />
        <p className="tnum text-xs text-fg-3">
          {t('campaign.dayOf', { day: num(elapsed), total: num(total) })}
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('campaign.progressTarget')}</h2>
          <span className="tnum text-sm text-fg-2">{target != null ? pct(target) : '—'}</span>
        </div>
        <ProgressBar
          value={target ?? 0}
          max={1}
          label={t('campaign.progressTarget')}
          tone={target != null && elapsed / total - target > 0.15 ? 'warn' : 'accent'}
        />
        <p className="tnum text-xs text-fg-3">
          {salesTarget
            ? t('campaign.targetUnits', { value: num(salesTarget) })
            : t('campaign.noTarget')}
        </p>
      </div>
    </Surface>
  );
}

/* ------------------------------------------------------------------- Team */

function TeamPanel({ campaign }) {
  const { t } = useTranslation('pro');
  const { num } = useFormat();
  const canRead = useCan('assignment.read');
  const approved = useCampaignResource(
    `/campaigns/${campaign.id}/assignments`,
    { status: 'approved', page: 1, pageSize: 1 },
    { enabled: canRead },
  );
  const proposed = useCampaignResource(
    `/campaigns/${campaign.id}/assignments`,
    { status: 'proposed', page: 1, pageSize: 1 },
    { enabled: canRead },
  );
  const managers = new Map();
  for (const wilaya of campaign.wilayas)
    for (const member of wilaya.staff) managers.set(member.user.id, member.user);
  const people = [...managers.values()];
  return (
    <Section title={t('campaign.team')}>
      <dl className="grid grid-cols-3 gap-3">
        {[
          ['assigned', approved.data?.meta?.total, campaign.requiredAnimateurs],
          ['proposed', proposed.data?.meta?.total],
          ['wilayas', campaign.wilayas.length],
        ].map(([key, value, of]) => (
          <div key={key}>
            <dd className="tnum text-xl font-semibold">
              {num(value)}
              {of != null && <span className="text-sm font-normal text-fg-3"> / {num(of)}</span>}
            </dd>
            <dt className="text-xs text-fg-3">{t('campaign.teamStat.' + key)}</dt>
          </div>
        ))}
      </dl>
      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2" aria-label={t('campaign.managers')}>
        {people.map((person) => (
          <li key={person.id} className="flex min-w-0 items-center gap-2">
            <Avatar name={person.fullName} size="sm" />
            <span className="min-w-0 leading-tight">
              <span className="block max-w-36 truncate text-xs font-medium">
                <bdi>{person.fullName}</bdi>
              </span>
              <span className="block text-2xs text-fg-3">{t('roleShort.' + person.role)}</span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ Stock */

function StockPanel({ campaign }) {
  const { t } = useTranslation('pro');
  const canRead = useCan('inventory.read');
  const balances = useCampaignResource(`/campaigns/${campaign.id}/stock/balances`, undefined, {
    enabled: canRead,
  });
  if (!canRead) return null;
  const totals = { warehouse: 0, in_transit: 0, holders: 0, distributed: 0, losses: 0 };
  for (const location of balances.data?.data?.locations ?? []) {
    const bucket =
      location.kind === 'warehouse'
        ? 'warehouse'
        : location.kind === 'in_transit'
          ? 'in_transit'
          : location.kind === 'customers'
            ? 'distributed'
            : /loss|damag|lost/.test(location.kind)
              ? 'losses'
              : 'holders';
    totals[bucket] += location.total ?? 0;
  }
  const empty = Object.values(totals).every((value) => value === 0);
  return (
    <Section
      title={t('campaign.stock')}
      actions={
        <Link className="text-xs text-accent-text hover:underline" to="?tab=stock">
          {t('campaign.openStock')}
        </Link>
      }
    >
      {balances.isPending ? (
        <Skeleton className="h-10" />
      ) : empty ? (
        <p className="text-sm text-fg-3">{t('campaign.stockEmpty')}</p>
      ) : (
        <StackedBar
          segments={[
            {
              key: 'warehouse',
              label: t('campaign.stockKinds.warehouse'),
              value: totals.warehouse,
              tone: 'soft',
            },
            {
              key: 'in_transit',
              label: t('campaign.stockKinds.in_transit'),
              value: totals.in_transit,
              tone: 'warn',
            },
            {
              key: 'holders',
              label: t('campaign.stockKinds.holders'),
              value: totals.holders,
              tone: 'info',
            },
            {
              key: 'distributed',
              label: t('campaign.stockKinds.distributed'),
              value: totals.distributed,
              tone: 'accent',
            },
            {
              key: 'losses',
              label: t('campaign.stockKinds.losses'),
              value: totals.losses,
              tone: 'bad',
            },
          ]}
        />
      )}
    </Section>
  );
}

/* --------------------------------------------------------------- Mini map */

function MiniMap({ campaign }) {
  const { t } = useTranslation('pro');
  const now = businessToday();
  const from = campaign.startDate.slice(0, 10);
  const stores = useReport(
    '/geo/stores',
    {
      campaignIds: [campaign.id],
      from,
      to: now < campaign.endDate.slice(0, 10) ? now : campaign.endDate.slice(0, 10),
    },
    now >= from,
  );
  const rows = (stores.data?.stores ?? []).filter((store) => store.latitude != null);
  return (
    <Section
      title={t('campaign.map')}
      actions={
        <Link className="text-xs text-accent-text hover:underline" to="?tab=field&sub=map">
          {t('campaign.openMap')}
        </Link>
      }
    >
      <div className="overflow-hidden rounded-lg border border-line">
        {rows.length ? (
          <Suspense fallback={<Skeleton className="h-60 rounded-none" />}>
            <StoreMap stores={rows} mode="plain" cluster={false} height="15rem" />
          </Suspense>
        ) : stores.isPending ? (
          <Skeleton className="h-60 rounded-none" />
        ) : (
          <p className="flex h-60 items-center justify-center gap-2 text-sm text-fg-3">
            <MapPin aria-hidden="true" size={16} /> {t('campaign.mapEmpty')}
          </p>
        )}
      </div>
    </Section>
  );
}

/* --------------------------------------------------------- Activity feed */

const FEED_ICONS = {
  attendance: ClipboardCheck,
  sale: ShoppingBag,
  issue: CircleAlert,
  visit: MapPin,
  stock: Package,
  gift: Gift,
};

/** Latest events of the campaign, merged from the same scoped lists the tabs use. */
function ActivityFeed({ campaign }) {
  const { t } = useTranslation('pro');
  const canAttendance = useCan('attendance.read');
  const canSales = useCan('sale.read');
  const canIssues = useCan('issue.read');
  const canVisits = useCan('visit.read');
  const canStock = useCan('inventory.read');
  const base = `/campaigns/${campaign.id}`;
  const attendance = useCampaignResource(
    base + '/attendance',
    { pageSize: 6, sort: '-recordedAt' },
    { enabled: canAttendance },
  );
  const sales = useCampaignResource(base + '/sales', { pageSize: 6 }, { enabled: canSales });
  const issues = useCampaignResource(
    '/issues',
    { campaignId: campaign.id, pageSize: 4 },
    { enabled: canIssues },
  );
  const visits = useCampaignResource(base + '/visits', { pageSize: 4 }, { enabled: canVisits });
  const movements = useCampaignResource(
    base + '/stock/movements',
    { pageSize: 4, type: 'adjustment' },
    { enabled: canStock },
  );
  const events = [];
  for (const row of attendance.data?.data ?? [])
    events.push({
      key: 'a' + row.id,
      kind: 'attendance',
      at: row.recordedAt,
      who: row.animateur?.fullName,
      what: t('feed.checkin', { checkpoint: row.checkpoint }),
      flag: row.isLate ? t('feed.late') : null,
    });
  for (const row of sales.data?.data ?? [])
    events.push({
      key: 's' + row.id,
      kind: 'sale',
      at: row.soldAt,
      who: row.animateur?.fullName,
      what: t('feed.sale', { units: row.units }),
      where: row.pointOfSale?.name,
    });
  for (const row of issues.data?.data ?? [])
    events.push({
      key: 'i' + row.id,
      kind: 'issue',
      at: row.createdAt,
      who: row.reportedBy?.fullName,
      what: row.title,
    });
  for (const row of visits.data?.data ?? [])
    events.push({
      key: 'v' + row.id,
      kind: 'visit',
      at: row.visitedAt,
      who: row.supervisor?.fullName,
      what: t('feed.visit'),
      where: row.pointOfSale?.name,
    });
  for (const row of movements.data?.data ?? [])
    events.push({
      key: 'm' + row.id,
      kind: 'stock',
      at: row.createdAt,
      who: row.createdBy?.fullName,
      what: t('feed.adjustment'),
    });
  events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const shown = events.slice(0, 8);
  const loading = [attendance, sales].some(
    (query) => query.isPending && query.fetchStatus !== 'idle',
  );
  return (
    <Section title={t('campaign.activity')}>
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      ) : shown.length ? (
        <ol className="grid gap-0.5">
          {shown.map((event) => {
            const Icon = FEED_ICONS[event.kind];
            return (
              <li key={event.key} className="flex items-start gap-3 rounded-md px-1 py-1.5">
                <span
                  aria-hidden="true"
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-sunken text-fg-3"
                >
                  <Icon size={13} strokeWidth={1.75} />
                </span>
                <p className="min-w-0 flex-1 text-sm text-fg-2">
                  <bdi className="font-medium text-fg">{event.who}</bdi> <bdi>{event.what}</bdi>
                  {event.where && (
                    <span className="text-fg-3">
                      {' · '}
                      <bdi>{event.where}</bdi>
                    </span>
                  )}
                  {event.flag && <span className="ms-1.5 text-xs text-warning">{event.flag}</span>}
                </p>
                <Ago at={event.at} className="shrink-0 text-xs text-fg-3" />
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          title={t('campaign.activityEmptyTitle')}
          message={t('campaign.activityEmpty')}
        />
      )}
    </Section>
  );
}

/* -------------------------------------------------------------- Readiness */

/** What stands between the campaign and its next steps: a tick when ready, the reason when not. */
function ReadinessChecklist({ campaign }) {
  const { t } = useTranslation('pro');
  const { t: tc, i18n } = useTranslation('common');
  const canSee = useCan('campaign.manage');
  const readiness = useReadiness(campaign.id);
  const wilayas = useWilayas();
  if (!canSee) return null;
  const labels = areaOptions(wilayas.data?.data, i18n.resolvedLanguage);
  const wilayaName = (id) => labels.find((item) => item.value === id)?.label ?? id;
  const actions = (readiness.data?.data.actions ?? []).filter((item) => item.action !== 'cancel');
  return (
    <Section title={t('campaign.readiness')}>
      {readiness.isPending ? (
        <Skeleton className="h-24" />
      ) : actions.length ? (
        <ul className="grid gap-3">
          {actions.map((item) => (
            <li key={item.action} className="flex items-start gap-3">
              {item.allowed ? (
                <CircleCheck
                  aria-hidden="true"
                  size={16}
                  className="mt-0.5 shrink-0 text-success"
                />
              ) : (
                <CircleX aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-danger" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {tc('campaigns.lifecycle.actions.' + item.action)}
                  <span
                    className={cn(
                      'ms-2 text-xs font-normal',
                      item.allowed ? 'text-success' : 'text-fg-3',
                    )}
                  >
                    {item.allowed ? t('campaign.ready') : t('campaign.notReady')}
                  </span>
                </p>
                {!item.allowed && <BlockerList blockers={item.blockers} wilayaName={wilayaName} />}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">{t('campaign.noNextSteps')}</p>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- Overview */

/** The campaign as a dashboard: progress, KPIs, map, team, stock, latest activity and readiness. */
export function CampaignOverview({ campaign }) {
  const { t } = useTranslation('pro');
  const canReport = useCan('reports.read');
  const now = businessToday();
  const end = campaign.endDate.slice(0, 10);
  const filters = {
    campaignIds: [campaign.id],
    from: campaign.startDate.slice(0, 10),
    to: now < end ? now : end,
  };
  const kpis = useReport('/kpis', filters, canReport && now >= filters.from);
  const trend = useReport(
    '/breakdown',
    { campaignIds: [campaign.id], from: addDays(now, -13), to: now, dimension: 'day' },
    canReport && now >= filters.from,
  );
  const notStarted = now < filters.from;
  return (
    <div className="space-y-6">
      {notStarted && (
        <EmptyState title={t('campaign.notStartedTitle')} message={t('campaign.notStarted')}>
          <Link className={buttonClass({ variant: 'secondary', size: 'sm' })} to="?tab=setup">
            {t('campaign.openSetup')}
          </Link>
        </EmptyState>
      )}
      {canReport && !notStarted && <ProgressPanel campaign={campaign} values={kpis.data} />}
      {canReport && !notStarted && kpis.data && (
        <KpiRow values={kpis.data} trend={trend.data} compare={false} />
      )}
      {canReport && !notStarted && kpis.isPending && <Skeleton className="h-44 rounded-lg" />}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">{canReport && <MiniMap campaign={campaign} />}</div>
        <div className="space-y-6">
          <TeamPanel campaign={campaign} />
          <StockPanel campaign={campaign} />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityFeed campaign={campaign} />
        <ReadinessChecklist campaign={campaign} />
      </div>
    </div>
  );
}
