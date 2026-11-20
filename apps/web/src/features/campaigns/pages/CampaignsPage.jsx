import { CAMPAIGN_STATUSES } from '@fieldflow/shared';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { FilterBar, useFilters } from '../../../shared/ui/FilterBar.jsx';
import { PageHeader } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useWilayas } from '../../organization/api.js';
import {
  areaOptions,
  InputField,
  primaryStyle,
  SelectField,
} from '../../organization/components/Fields.jsx';
import { useCampaigns, useClientOptions } from '../api.js';
import { CampaignStatus, formatPeriod } from '../components/CampaignStatus.jsx';

export function CampaignsPage() {
  const { t, i18n } = useTranslation('common');
  const manage = useCan('campaign.manage');
  const canReadClients = useCan('catalog.read');
  const navigate = useNavigate();
  const { search } = useLocation();
  const { filters, setFilter } = useFilters();
  const campaigns = useCampaigns(filters);
  const wilayas = useWilayas();
  const clients = useClientOptions('');
  const { message } = useApiError(campaigns.error);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const columns = [
    {
      accessorKey: 'name',
      header: t('admin.name'),
      meta: { sortable: true },
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          to={row.original.id}
          state={{ listSearch: search }}
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'code',
      header: t('admin.code'),
      meta: { sortable: true },
      cell: ({ getValue }) => <bdi dir="ltr">{getValue()}</bdi>,
    },
    {
      accessorKey: 'status',
      header: t('admin.status'),
      cell: ({ getValue }) => <CampaignStatus status={getValue()} />,
    },
    {
      accessorKey: 'startDate',
      header: t('campaigns.period'),
      meta: { sortable: true },
      cell: ({ row }) => formatPeriod(row.original, i18n.resolvedLanguage),
    },
    { id: 'client', header: t('admin.client'), cell: ({ row }) => row.original.client?.name },
    {
      accessorKey: 'requiredAnimateurs',
      header: t('campaigns.requiredAnimateurs'),
      cell: ({ getValue }) => (getValue() == null ? '—' : number.format(getValue())),
    },
  ];
  return (
    <>
      <PageHeader title={t('admin.campaigns')}>
        {manage && (
          <Link to="new" className={primaryStyle}>
            {t('campaigns.new')}
          </Link>
        )}
      </PageHeader>
      <FilterBar>
        <InputField
          name="search"
          type="search"
          value={filters.q}
          onChange={(value) => setFilter('q', value)}
        />
        <SelectField
          name="status"
          blank="all"
          value={filters.status}
          options={CAMPAIGN_STATUSES.map((status) => ({
            value: status,
            label: t('campaigns.status.' + status),
          }))}
          onChange={(value) => setFilter('status', value)}
        />
        {canReadClients && (
          <SelectField
            name="client"
            blank="all"
            value={filters.clientId}
            options={clients.options}
            onChange={(value) => setFilter('clientId', value)}
          />
        )}
        <SelectField
          name="wilaya"
          blank="all"
          value={filters.wilayaId}
          options={areaOptions(wilayas.data?.data, i18n.resolvedLanguage)}
          onChange={(value) => setFilter('wilayaId', value)}
        />
        <InputField
          name="from"
          type="date"
          value={filters.from}
          onChange={(value) => setFilter('from', value)}
        />
        <InputField
          name="to"
          type="date"
          value={filters.to}
          onChange={(value) => setFilter('to', value)}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={campaigns.data?.data ?? []}
        {...campaigns.data?.meta}
        page={Number(filters.page) || 1}
        sort={filters.sort ?? 'startDate:desc'}
        loading={campaigns.isPending || campaigns.isPlaceholderData}
        error={message}
        onSort={(value) => setFilter('sort', value)}
        onPage={(value) => setFilter('page', value)}
        onRowClick={(row) => navigate(row.id, { state: { listSearch: search } })}
      />
    </>
  );
}
