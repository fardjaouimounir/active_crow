import { issueCategories, ISSUE_STATUSES } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { DataTable } from '../../shared/ui/DataTable.jsx';
import { FilterBar, useFilters } from '../../shared/ui/FilterBar.jsx';
import { PageHeader, StatusBadge } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useCampaigns } from '../campaigns/api.js';
import { useCommunication } from '../notifications/api.js';
import { useWilayas } from '../organization/api.js';
import { SelectField, areaOptions, primaryStyle } from '../organization/components/Fields.jsx';
import { IssueForm } from './IssueForm.jsx';

export function IssuesPage({ campaignId }) {
  const { t, i18n } = useTranslation('common');
  const allowCreate = useCan('issue.create');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const { filters, setFilter } = useFilters();
  const query = useCommunication('/issues', {
    page: filters.issuePage,
    status: filters.issueStatus,
    category: filters.issueCategory,
    campaignId: campaignId ?? filters.issueCampaign,
    wilayaId: filters.issueWilaya,
    assignedToMe: filters.issueMine,
  });
  const campaigns = useCampaigns({ pageSize: 100 });
  const wilayas = useWilayas();
  const { message } = useApiError(query.error);
  const meta = query.data?.meta;
  const columns = [
    {
      id: 'title',
      header: t('admin.title'),
      cell: ({ row }) => (
        <Link className="underline" to={'/app/issues/' + row.original.id}>
          {row.original.title}
        </Link>
      ),
    },
    { id: 'campaign', header: t('admin.campaign'), cell: ({ row }) => row.original.campaign.name },
    {
      id: 'category',
      header: t('admin.category'),
      cell: ({ row }) => t('issues.categories.' + row.original.category),
    },
    {
      id: 'status',
      header: t('admin.status'),
      cell: ({ row }) => <StatusBadge>{t('issues.status.' + row.original.status)}</StatusBadge>,
    },
  ];
  return (
    <>
      <PageHeader title={t('admin.issues')}>
        {allowCreate && (
          <button type="button" className={primaryStyle} onClick={() => setCreating(true)}>
            {t('issues.new')}
          </button>
        )}
      </PageHeader>
      {meta?.counts && (
        <div className="mb-3 flex flex-wrap gap-2">
          {ISSUE_STATUSES.map((status) => (
            <StatusBadge key={status}>
              {t('issues.status.' + status)} {meta.counts[status]}
            </StatusBadge>
          ))}
        </div>
      )}
      <FilterBar>
        <SelectField
          name="status"
          blank="all"
          value={filters.issueStatus}
          onChange={(value) => setFilter('issueStatus', value)}
          options={ISSUE_STATUSES.map((value) => ({ value, label: t('issues.status.' + value) }))}
        />
        <SelectField
          name="category"
          blank="all"
          value={filters.issueCategory}
          onChange={(value) => setFilter('issueCategory', value)}
          options={issueCategories.map((value) => ({
            value,
            label: t('issues.categories.' + value),
          }))}
        />
        {!campaignId && (
          <SelectField
            name="campaign"
            blank="all"
            value={filters.issueCampaign}
            onChange={(value) => setFilter('issueCampaign', value)}
            options={(campaigns.data?.data ?? []).map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
          />
        )}
        <SelectField
          name="wilaya"
          blank="all"
          value={filters.issueWilaya}
          onChange={(value) => setFilter('issueWilaya', value)}
          options={areaOptions(wilayas.data?.data, i18n.resolvedLanguage)}
        />
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={filters.issueMine === 'true'}
            onChange={(event) => setFilter('issueMine', event.target.checked ? 'true' : '')}
          />
          {t('issues.mine')}
        </label>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={query.data?.data ?? []}
        {...meta}
        onPage={(page) => setFilter('issuePage', page)}
        loading={query.isPending}
        error={message}
      />
      {creating && (
        <IssueForm
          campaignId={campaignId}
          onClose={() => setCreating(false)}
          onCreated={(issue) => navigate('/app/issues/' + issue.id)}
        />
      )}
    </>
  );
}
