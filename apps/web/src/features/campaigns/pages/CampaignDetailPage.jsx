import { IssuesPage } from '../../issues/IssuesPage.jsx';
import { AttendanceTab } from '../../attendance/AttendanceTab.jsx';
import { VisitsTab } from '../../attendance/VisitsTab.jsx';
import { canEdit as canEditArea } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { useFilters } from '../../../shared/ui/FilterBar.jsx';
import { PageHeader, Toast } from '../../../shared/ui/PageParts.jsx';
import { Tabs } from '../../../shared/ui/Tabs.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { actionStyle } from '../../organization/components/Fields.jsx';
import { formatMoney } from '../../catalog/money.js';
import { AssignmentsTab } from '../../assignments/AssignmentsTab.jsx';
import { useCampaign } from '../api.js';
import { CampaignForm } from '../components/CampaignForm.jsx';
import { CampaignStatus, formatPeriod } from '../components/CampaignStatus.jsx';
import { CoverageTab } from '../components/CoverageTab.jsx';
import { DocumentsTab } from '../components/DocumentsTab.jsx';
import { HistoryTab } from '../components/HistoryTab.jsx';
import { LifecyclePanel } from '../components/LifecyclePanel.jsx';
import { PointsOfSaleTab } from '../components/PointsOfSaleTab.jsx';
import { ProductsTab } from '../components/ProductsTab.jsx';
import { StockTab } from '../../inventory/StockTab.jsx';
import { RulesTab } from '../components/RulesTab.jsx';

const TABS = [
  'overview',
  'coverage',
  'pointsOfSale',
  'products',
  'rules',
  'assignments',
  'attendance',
  'visits',
  'issues',
  'stock',
  'documents',
  'history',
];
/** The edit-policy area each tab changes (the overview form decides field by field). */
const TAB_AREA = {
  coverage: 'coverage',
  pointsOfSale: 'coverage',
  products: 'products',
  rules: 'ruleSet',
  documents: 'documents',
};

function Overview({ campaign, canManage }) {
  const { t, i18n } = useTranslation('common');
  const [saved, setSaved] = useState(false);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const anyField = ['details', 'startDate', 'endDate', 'approver'].some(
    (area) => canEditArea(campaign, area).allowed,
  );
  return (
    <div className="grid gap-4">
      <LifecyclePanel campaign={campaign} />
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
          {saved && <Toast message={t('admin.saved')} />}
          {canManage && anyField ? (
            <CampaignForm
              key={campaign.version}
              campaign={campaign}
              onSuccess={() => setSaved(true)}
            />
          ) : (
            <dl className="grid gap-3 text-sm">
              {[
                ['client', campaign.client?.name],
                ['period', formatPeriod(campaign, i18n.resolvedLanguage)],
                ['description', campaign.description ?? '—'],
                ['budgetAmount', formatMoney(campaign.budgetAmount, i18n.resolvedLanguage)],
                ['assignmentApproverRole', t('roles.' + campaign.assignmentApproverRole)],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt className="font-medium">
                    {t(key === 'period' ? 'campaigns.period' : 'admin.' + key)}
                  </dt>
                  <dd>
                    <bdi>{value}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <dl className="grid gap-3 text-sm">
            {Object.entries(campaign.counts).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-3">
                <dt className="font-medium">{t('campaigns.counts.' + key)}</dt>
                <dd>{number.format(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </div>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { t } = useTranslation('common');
  const canManage = useCan('campaign.manage');
  const showIssues = useCan('issue.read');
  const showAssignments = useCan('assignment.read');
  const showStock = useCan('inventory.read');
  const showAttendance = useCan('attendance.read');
  const showVisits = useCan('visit.read');
  const { filters, setFilters } = useFilters();
  const query = useCampaign(id);
  const { message } = useApiError(query.error);
  const tabs = TABS.filter(
    (item) =>
      (showAssignments || item !== 'assignments') &&
      (showIssues || item !== 'issues') &&
      (showAttendance || item !== 'attendance') &&
      (showVisits || item !== 'visits') &&
      (showStock || item !== 'stock'),
  );
  const tab = tabs.includes(filters.tab) ? filters.tab : 'overview';
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (query.isError) return <Toast error message={message} />;
  const campaign = query.data.data;
  // Edit controls follow the same status matrix as the API.
  const allowed = (area, change) => canManage && canEditArea(campaign, area, change).allowed;
  const area = TAB_AREA[tab];
  const lockedNote =
    area && canManage && !allowed(area) ? (
      <p role="note" className="mb-3 text-sm text-amber-800">
        {t('campaigns.locked', { status: t('campaigns.status.' + campaign.status) })}
      </p>
    ) : null;
  return (
    <>
      <PageHeader title={campaign.name}>
        <div className="flex flex-wrap items-center gap-3">
          <bdi dir="ltr" className="text-sm text-slate-600">
            {campaign.code}
          </bdi>
          <CampaignStatus status={campaign.status} />
          <Link
            className={actionStyle}
            to={{ pathname: '/app/campaigns', search: location.state?.listSearch ?? '' }}
          >
            {t('admin.campaigns')}
          </Link>
        </div>
      </PageHeader>
      <Tabs
        label={campaign.name}
        value={tab}
        tabs={tabs.map((value) => ({ value, label: t('campaigns.tabs.' + value) }))}
        onChange={(value) => setFilters({ tab: value })}
      >
        {lockedNote}
        {tab === 'overview' && <Overview campaign={campaign} canManage={canManage} />}
        {tab === 'coverage' && <CoverageTab campaign={campaign} canEdit={allowed('coverage')} />}
        {tab === 'pointsOfSale' && (
          <PointsOfSaleTab campaign={campaign} canEdit={allowed('coverage')} />
        )}
        {tab === 'products' && (
          <ProductsTab
            campaign={campaign}
            canEdit={allowed('products')}
            canRemove={allowed('products', { removing: true })}
          />
        )}
        {tab === 'rules' && <RulesTab campaign={campaign} canEdit={allowed('ruleSet')} />}
        {tab === 'documents' && <DocumentsTab campaign={campaign} canEdit={allowed('documents')} />}
        {tab === 'stock' && <StockTab campaign={campaign} />}
        {tab === 'issues' && <IssuesPage campaignId={id} />}
        {tab === 'assignments' && <AssignmentsTab campaign={campaign} />}
        {tab === 'attendance' && <AttendanceTab campaign={campaign} />}
        {tab === 'visits' && <VisitsTab campaign={campaign} />}
        {tab === 'history' && <HistoryTab campaignId={campaign.id} />}
      </Tabs>
    </>
  );
}
