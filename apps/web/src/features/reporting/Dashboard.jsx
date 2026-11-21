import { reportingFilterFields, reportingFilters, today } from '@fieldflow/shared';
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { DashboardFilters, monday } from './DashboardFilters.jsx';
import {
  AiActionButton,
  AiCommentaryCard,
  CampaignAiActions,
  CampaignAiCards,
} from '../ai/AiUi.jsx';
import { useReport } from './api.js';
// The map sections (boundary data, store maps) load only when the dashboard shows them.
const GeographySection = lazy(() =>
  import('./GeographySection.jsx').then((module) => ({ default: module.GeographySection })),
);
const LiveFieldSection = lazy(() =>
  import('./GeographySection.jsx').then((module) => ({ default: module.LiveFieldSection })),
);
import {
  BreakdownTable,
  Cards,
  DailyChart,
  ExportButton,
  useReportingText,
} from './ReportingUi.jsx';

const fields = Object.keys(reportingFilterFields);
export function Dashboard() {
  const { user } = useAuth();
  const canExport = useCan('reports.export');
  const { t, num } = useReportingText();
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
  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        {canExport && parsed.success && <ExportButton filters={mainFilters} />}
      </div>
      <DashboardFilters
        raw={raw}
        update={update}
        options={current.data?.options}
        period={current.data?.period}
      />
      {parsed.success && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
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
      {parsed.success && (current.isPending || current.isPlaceholderData) && (
        <div role="status" className="animate-pulse rounded-xl bg-sunken p-6">
          {t('loading')}
        </div>
      )}
      {[current, series, team, stores, week].some((result) => result.isError) && (
        <p role="alert">{t('error')}</p>
      )}
      {values && (
        <>
          <Cards values={values} supervisor={supervisor} />
          <section className="rounded-lg border border-line bg-surface p-4">
            <h2 className="font-semibold tracking-tight">{t('alerts')}</h2>
            <dl className="mt-2 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
              {[
                ['failures', values.stock?.failingChecks],
                ['undelivered', values.gifts.undeliveredUnits],
                [
                  'unvisited',
                  supervisor ? week.data?.alerts?.unvisitedInPeriod : values.alerts.unvisitedStores,
                ],
                ['oldPending', values.alerts.oldPending],
              ].map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3 border-b border-line py-1">
                  <dt className="text-fg-2">{t(key)}</dt>
                  <dd
                    className={
                      'tnum flex items-center gap-1.5 ' +
                      (value > 0 ? 'font-semibold text-warning' : 'text-fg-3')
                    }
                  >
                    {value > 0 && <TriangleAlert aria-hidden="true" size={14} />}
                    {num(value)}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
      <Suspense fallback={null}>
        {parsed.success && (supervisor || regional) && <LiveFieldSection filters={filters} />}
        {parsed.success && !supervisor && <GeographySection filters={filters} update={update} />}
      </Suspense>
      {!supervisor && series.data && (
        <div className="grid gap-4 xl:grid-cols-2">
          <DailyChart rows={series.data} />
          <DailyChart rows={series.data} attendance />
        </div>
      )}
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
