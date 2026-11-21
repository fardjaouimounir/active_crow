import { reportingFilterFields, reportingFilters, today } from '@fieldflow/shared';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { PageHeader } from '../../shared/ui/PageParts.jsx';
import { Skeleton } from '../../ui/primitives.jsx';
import { useFormat } from '../../ui/format.js';
import { DashboardFilters, monday } from './DashboardFilters.jsx';
import {
  AiActionButton,
  AiCommentaryCard,
  CampaignAiActions,
  CampaignAiCards,
} from '../ai/AiUi.jsx';
import { useReport } from './api.js';
import {
  AttentionList,
  KpiRow,
  SalesAreaChart,
  SupervisorToday,
  TodayStrip,
  addDays,
} from './DashboardParts.jsx';
// The map sections (boundary data, store maps) load only when the dashboard shows them.
const GeographySection = lazy(() =>
  import('./GeographySection.jsx').then((module) => ({ default: module.GeographySection })),
);
import { BreakdownTable, DailyChart, ExportButton, useReportingText } from './ReportingUi.jsx';

const fields = Object.keys(reportingFilterFields);

function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" className="space-y-4">
      <Skeleton className="h-44 w-full rounded-lg" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const canExport = useCan('reports.export');
  const { t } = useReportingText();
  const { t: tp } = useTranslation('pro');
  const { date } = useFormat();
  const [params, setParams] = useSearchParams();
  const raw = Object.fromEntries(
    fields.filter((key) => params.get(key)).map((key) => [key, params.get(key)]),
  );
  const parsed = reportingFilters.safeParse(raw);
  const filters = parsed.data ?? {};
  const supervisor = user.role === 'supervisor';
  const regional = user.role === 'regional_manager';
  const now = today();
  const mainFilters =
    !filters.from && !filters.to && supervisor ? { ...filters, from: now, to: now } : filters;
  const dimension = supervisor ? 'animateur' : regional ? 'supervisor' : 'campaign';
  const current = useReport('/kpis', mainFilters, parsed.success, {
    placeholderData: (previous) =>
      previous && { options: previous.options, period: previous.period },
  });
  const series = useReport(
    '/breakdown',
    { ...mainFilters, dimension: 'day' },
    parsed.success && !supervisor,
  );
  // The comparison line: the same chart for the period before.
  const previousPeriod = current.data?.previous?.period;
  const previousSeries = useReport(
    '/breakdown',
    { ...mainFilters, ...previousPeriod, dimension: 'day' },
    parsed.success && !supervisor && Boolean(previousPeriod),
  );
  // Sparklines always show the last 14 days, whatever period the filters select.
  const scope = { ...filters };
  delete scope.from;
  delete scope.to;
  const trend = useReport(
    '/breakdown',
    { ...scope, from: addDays(now, -13), to: now, dimension: 'day' },
    parsed.success,
  );
  const team = useReport('/breakdown', { ...mainFilters, dimension }, parsed.success);
  const stores = useReport(
    '/breakdown',
    { ...mainFilters, dimension: 'point_of_sale' },
    parsed.success && !supervisor,
  );
  const week = useReport(
    '/kpis',
    { ...filters, from: monday(now), to: now },
    parsed.success && supervisor,
  );
  const update = (patch) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries(patch).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key),
      );
      return next;
    });
  const sortedStores = [...(stores.data ?? [])].sort(
    (a, b) => b.sales.units - a.sales.units || a.id.localeCompare(b.id),
  );
  const values = current.isPlaceholderData ? undefined : current.data;
  const campaignId = filters.campaignIds?.length === 1 ? filters.campaignIds[0] : null;
  const supervisorId = supervisor
    ? user.id
    : filters.supervisorIds?.length === 1
      ? filters.supervisorIds[0]
      : null;
  const oneDay = mainFilters.from && mainFilters.from === mainFilters.to;
  const period = current.data?.period;
  const context = period
    ? [
        period.from === period.to
          ? date(period.from)
          : `${date(period.from, { day: 'numeric', month: 'short' })} – ${date(period.to)}`,
        tp('dash.scope.' + (supervisor ? 'supervisor' : regional ? 'regional' : 'agency')),
      ].join(' · ')
    : undefined;
  const attentionValues =
    supervisor && values
      ? {
          ...values,
          alerts: { ...values.alerts, unvisitedStores: week.data?.alerts?.unvisitedInPeriod ?? 0 },
        }
      : values;
  return (
    <section className="space-y-6">
      <PageHeader title={t('heading')} context={context}>
        {canExport && parsed.success && <ExportButton filters={mainFilters} />}
      </PageHeader>
      {parsed.success && <TodayStrip filters={filters} now={now} />}
      <DashboardFilters
        raw={raw}
        update={update}
        options={current.data?.options}
        period={current.data?.period}
      />
      {parsed.success && (
        <div className="space-y-3 empty:hidden">
          <div className="flex flex-wrap gap-3 empty:hidden">
            {supervisorId && (
              <AiActionButton
                capability="supervisor_daily_summary"
                subjectId={supervisorId}
                filters={oneDay ? { workDate: mainFilters.from } : {}}
              />
            )}
            {!supervisor && (
              <CampaignAiActions
                campaignId={campaignId}
                period={mainFilters}
                salesTarget={values?.completion?.salesTarget}
              />
            )}
          </div>
          {supervisorId && (
            <AiCommentaryCard
              capability="supervisor_daily_summary"
              subjectId={supervisorId}
              period={oneDay ? { from: mainFilters.from, to: mainFilters.to } : undefined}
            />
          )}
          {!supervisor && <CampaignAiCards campaignId={campaignId} period={mainFilters} />}
        </div>
      )}
      {!parsed.success && <p role="alert">{t('invalid')}</p>}
      {parsed.success && (current.isPending || current.isPlaceholderData) && <DashboardSkeleton />}
      {[current, series, team, stores, week].some((result) => result.isError) && (
        <p role="alert">{t('error')}</p>
      )}
      {values && <KpiRow values={values} trend={trend.data} supervisor={supervisor} />}
      {supervisor && parsed.success && <SupervisorToday date={now} />}
      {!supervisor && series.data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <SalesAreaChart rows={series.data} previousRows={previousSeries.data} />
          <DailyChart rows={series.data} attendance dashboard />
        </div>
      )}
      <Suspense fallback={null}>
        {parsed.success && !supervisor && (
          <div id="geography" className="scroll-mt-6">
            <GeographySection filters={filters} update={update} />
          </div>
        )}
      </Suspense>
      {attentionValues && <AttentionList values={attentionValues} supervisor={supervisor} />}
      {team.data && (
        <BreakdownTable
          rows={team.data}
          title={supervisor ? 'byAnimateur' : regional ? 'bySupervisor' : 'byCampaign'}
        />
      )}
      {stores.data &&
        (sortedStores.length <= 20 ? (
          <BreakdownTable
            rows={sortedStores.map((store, index) => ({ ...store, rank: index + 1 }))}
            title="rankedStores"
            ranked
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownTable rows={sortedStores.slice(0, 10)} title="topStores" />
            <BreakdownTable rows={sortedStores.slice(-10).reverse()} title="bottomStores" />
          </div>
        ))}
    </section>
  );
}
