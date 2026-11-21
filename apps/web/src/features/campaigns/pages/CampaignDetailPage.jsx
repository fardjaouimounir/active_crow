import { IssuesPage } from '../../issues/IssuesPage.jsx';
import { AttendanceTab } from '../../attendance/AttendanceTab.jsx';
import { VisitsTab } from '../../attendance/VisitsTab.jsx';
import { SalesTab } from '../../sales/SalesTab.jsx';
import { TombolaTab } from '../../sales/TombolaTab.jsx';
import { canEdit as canEditArea, today } from '@fieldflow/shared';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useParams } from 'react-router';
import { useAuth, useCan } from '../../../shared/auth/hooks.js';
import { useFilters } from '../../../shared/ui/FilterBar.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { Tabs } from '../../../shared/ui/Tabs.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useFormat } from '../../../ui/format.js';
import { Avatar, Skeleton, cn } from '../../../ui/primitives.jsx';
import { AssignmentsTab } from '../../assignments/AssignmentsTab.jsx';
import { useCampaign } from '../api.js';
import { CampaignOverview } from '../components/CampaignOverview.jsx';
import { CampaignStatus } from '../components/CampaignStatus.jsx';
import { CoverageTab } from '../components/CoverageTab.jsx';
import { TeamTab } from '../components/TeamTab.jsx';
import { DocumentsTab } from '../components/DocumentsTab.jsx';
import { HistoryTab } from '../components/HistoryTab.jsx';
import { LifecycleActions } from '../components/LifecycleActions.jsx';
import { LifecycleStepper } from '../components/LifecyclePanel.jsx';
import { SetupGeneral } from '../components/SetupGeneral.jsx';
import { usePageCrumb } from '../../../ui/controls.jsx';
import { PointsOfSaleTab } from '../components/PointsOfSaleTab.jsx';
import { ProductsTab } from '../components/ProductsTab.jsx';
import { StockTab } from '../../inventory/StockTab.jsx';
const StoreMapPanel = lazy(() =>
  import('../../reporting/GeographySection.jsx').then((module) => ({
    default: module.StoreMapPanel,
  })),
);
import { RulesTab } from '../components/RulesTab.jsx';

/** Seven primary tabs; the crowded ones carry a sub-navigation. */
const GROUPS = [
  { key: 'overview', subs: [] },
  { key: 'field', subs: ['attendance', 'visits', 'issues', 'map'] },
  { key: 'sales', subs: ['sales', 'tombola'] },
  { key: 'stock', subs: [] },
  { key: 'team', subs: ['coverage', 'team', 'assignments'] },
  { key: 'setup', subs: ['general', 'stores', 'products', 'rules', 'documents'] },
  { key: 'activity', subs: [] },
];
/** Links written before the grouping (`?tab=attendance`, blocker links…) keep working. */
const LEGACY = {
  attendance: ['field', 'attendance'],
  visits: ['field', 'visits'],
  issues: ['field', 'issues'],
  map: ['field', 'map'],
  tombola: ['sales', 'tombola'],
  coverage: ['team', 'coverage'],
  assignments: ['team', 'assignments'],
  pointsOfSale: ['setup', 'stores'],
  products: ['setup', 'products'],
  rules: ['setup', 'rules'],
  documents: ['setup', 'documents'],
  history: ['activity', null],
};
/** The edit-policy area each setup page changes (the general page decides field by field). */
const SUB_AREA = {
  coverage: 'coverage',
  stores: 'coverage',
  products: 'products',
  rules: 'ruleSet',
  documents: 'documents',
};

function ClientBadge({ name }) {
  return <Avatar name={name} size="lg" className="size-12 text-base" />;
}

/** "N days left" / "starts in N days" / "ended N days ago", from the business date. */
function useTimeline(campaign) {
  const { t } = useTranslation('pro');
  const { num } = useFormat();
  const day = (iso) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86_400_000);
  const now = day(today());
  if (now < day(campaign.startDate))
    return t('campaign.startsIn', { n: num(day(campaign.startDate) - now) });
  if (now > day(campaign.endDate))
    return t('campaign.endedAgo', { n: num(now - day(campaign.endDate)) });
  return t('campaign.daysLeft', { n: num(day(campaign.endDate) - now) });
}

function CampaignHeader({ campaign, listSearch }) {
  const { t } = useTranslation('common');
  const { date } = useFormat();
  const { user } = useAuth();
  const timeline = useTimeline(campaign);
  const extra = [];
  if (
    ['director', 'general_manager'].includes(user?.role) &&
    ['active', 'completed', 'closed'].includes(campaign.status)
  )
    extra.push({ to: `/app/campaigns/${campaign.id}/report`, label: t('admin.campaignReport') });
  extra.push({
    to: { pathname: '/app/campaigns', search: listSearch ?? '' },
    label: t('admin.campaigns'),
  });
  const range = `${date(campaign.startDate, { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${date(campaign.endDate, { dateStyle: 'medium', timeZone: 'UTC' })}`;
  return (
    <header className="mb-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-3.5">
          <ClientBadge name={campaign.client?.name} />
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              <bdi>{campaign.name}</bdi>
            </h1>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-fg-3">
              <CampaignStatus status={campaign.status} />
              <bdi dir="ltr" className="tnum">
                {campaign.code}
              </bdi>
              <span>
                <bdi>{campaign.client?.name}</bdi>
              </span>
              <span className="tnum">{range}</span>
              <span className="tnum font-medium text-fg-2">{timeline}</span>
            </p>
          </div>
        </div>
        <LifecycleActions campaign={campaign} extra={extra} />
      </div>
      <LifecycleStepper status={campaign.status} />
    </header>
  );
}

/** Small pill navigation inside a primary tab. */
function SubNav({ label, items, value, onChange }) {
  return (
    <nav aria-label={label} className="mb-5 flex gap-1 overflow-x-auto">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-current={item.value === value ? 'page' : undefined}
          onClick={() => onChange(item.value)}
          className={cn(
            'h-8 shrink-0 rounded-md px-3 text-sm font-medium transition-colors duration-150',
            item.value === value
              ? 'bg-sunken text-fg'
              : 'text-fg-3 hover:bg-sunken/60 hover:text-fg',
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
  const canManage = useCan('campaign.manage');
  const can = {
    issues: useCan('issue.read'),
    assignments: useCan('assignment.read'),
    team: useCan('assignment.propose'),
    stock: useCan('inventory.read'),
    attendance: useCan('attendance.read'),
    visits: useCan('visit.read'),
    sales: useCan('sale.read'),
    tombola: useCan('tombola.read'),
    reports: useCan('reports.read'),
  };
  const { filters, setFilters } = useFilters();
  const query = useCampaign(id);
  const { message } = useApiError(query.error);
  usePageCrumb(query.data?.data.name);

  // What this user may open, per sub-page; a group with nothing left disappears.
  const allowedSub = {
    attendance: can.attendance,
    visits: can.visits,
    issues: can.issues,
    map: can.reports,
    sales: can.sales,
    tombola: can.tombola,
    assignments: can.assignments,
    team: can.team,
  };
  const groups = GROUPS.map((group) => ({
    ...group,
    subs: group.subs.filter((sub) => allowedSub[sub] ?? true),
  })).filter(
    (group) =>
      (group.key !== 'stock' || can.stock) &&
      (group.subs.length > 0 || !GROUPS.find((g) => g.key === group.key).subs.length),
  );
  const [legacyGroup, legacySub] = LEGACY[filters.tab] ?? [];
  const requested = legacyGroup ?? filters.tab;
  const group = groups.find((item) => item.key === requested) ?? groups[0];
  const sub = group.subs.includes(filters.sub ?? legacySub)
    ? (filters.sub ?? legacySub)
    : group.subs[0];

  if (query.isPending)
    return (
      <div role="status" className="space-y-4">
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (query.isError) return <Toast error message={message} />;
  const campaign = query.data.data;
  // Edit controls follow the same status matrix as the API.
  const allowed = (area, change) => canManage && canEditArea(campaign, area, change).allowed;
  const area = SUB_AREA[sub];
  const lockedNote =
    area && canManage && !allowed(area) ? (
      <p role="note" className="mb-3 text-sm text-warning">
        {t('campaigns.locked', { status: t('campaigns.status.' + campaign.status) })}
      </p>
    ) : null;
  const go = (key) => setFilters({ tab: key, sub: null });
  return (
    <>
      <CampaignHeader campaign={campaign} listSearch={location.state?.listSearch} />
      <Tabs
        label={campaign.name}
        value={group.key}
        tabs={groups.map(({ key }) => ({ value: key, label: tp('campaign.tabs.' + key) }))}
        onChange={go}
      >
        {group.subs.length > 0 && (
          <SubNav
            label={tp('campaign.tabs.' + group.key)}
            items={group.subs.map((value) => ({ value, label: tp('campaign.sub.' + value) }))}
            value={sub}
            onChange={(value) => setFilters({ tab: group.key, sub: value })}
          />
        )}
        {lockedNote}
        {group.key === 'overview' && <CampaignOverview campaign={campaign} />}
        {sub === 'attendance' && <AttendanceTab campaign={campaign} />}
        {sub === 'visits' && <VisitsTab campaign={campaign} />}
        {sub === 'issues' && <IssuesPage campaignId={id} />}
        {sub === 'map' && (
          <Suspense fallback={<p role="status">{t('admin.loading')}</p>}>
            <StoreMapPanel
              filters={{
                campaignIds: [campaign.id],
                from: campaign.startDate.slice(0, 10),
                to: campaign.endDate.slice(0, 10),
              }}
            />
          </Suspense>
        )}
        {sub === 'sales' && <SalesTab campaign={campaign} />}
        {sub === 'tombola' && <TombolaTab campaign={campaign} />}
        {group.key === 'stock' && <StockTab campaign={campaign} />}
        {sub === 'coverage' && <CoverageTab campaign={campaign} canEdit={allowed('coverage')} />}
        {sub === 'team' && (
          <TeamTab campaign={campaign} canEdit={canEditArea(campaign, 'coverage').allowed} />
        )}
        {sub === 'assignments' && <AssignmentsTab campaign={campaign} />}
        {sub === 'general' && <SetupGeneral campaign={campaign} canManage={canManage} />}
        {sub === 'stores' && <PointsOfSaleTab campaign={campaign} canEdit={allowed('coverage')} />}
        {sub === 'products' && (
          <ProductsTab
            campaign={campaign}
            canEdit={allowed('products')}
            canRemove={allowed('products', { removing: true })}
          />
        )}
        {sub === 'rules' && <RulesTab campaign={campaign} canEdit={allowed('ruleSet')} />}
        {sub === 'documents' && <DocumentsTab campaign={campaign} canEdit={allowed('documents')} />}
        {group.key === 'activity' && <HistoryTab campaignId={campaign.id} />}
      </Tabs>
    </>
  );
}
