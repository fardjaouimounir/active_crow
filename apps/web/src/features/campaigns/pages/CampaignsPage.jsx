import { CAMPAIGN_STATUSES, today } from '@fieldflow/shared';
import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { useFilters } from '../../../shared/ui/FilterBar.jsx';
import { ListToolbar, useColumnVisibility } from '../../../shared/ui/ListToolbar.jsx';
import { PageHeader } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { Avatar } from '../../../ui/primitives.jsx';
import { ProgressBar } from '../../../ui/viz.jsx';
import { useFormat } from '../../../ui/format.js';
import { useWilayas } from '../../organization/api.js';
import { areaOptions, InputField, primaryStyle } from '../../organization/components/Fields.jsx';
import { useCampaigns, useClientOptions } from '../api.js';
import { CampaignStatus, formatPeriod } from '../components/CampaignStatus.jsx';

/** Dates, and for a running campaign a thin progress bar with the days left. */
function PeriodCell({ campaign, language }) {
  const { t: tp } = useTranslation('pro');
  const { num } = useFormat();
  const day = (iso) => Math.floor(Date.parse(iso.slice(0, 10) + 'T00:00:00Z') / 86_400_000);
  const start = day(campaign.startDate);
  const end = day(campaign.endDate);
  const now = day(today());
  const running = ['active', 'suspended'].includes(campaign.status) && now >= start && now <= end;
  return (
    <div className="min-w-36 space-y-1">
      <p className="tnum text-sm">{formatPeriod(campaign, language)}</p>
      {running && (
        <>
          <ProgressBar
            value={now - start + 1}
            max={end - start + 1}
            label={tp('campaign.progressTime')}
          />
          <p className="tnum text-2xs text-fg-3">
            {tp('campaign.daysLeft', { n: num(end - now) })}
          </p>
        </>
      )}
    </div>
  );
}

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
  const { num } = useFormat();
  const { t: tp } = useTranslation('pro');
  const columnState = useColumnVisibility('campaigns');
  const columns = [
    {
      accessorKey: 'name',
      header: t('admin.name'),
      meta: { sortable: true, width: '30%' },
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.original.client?.name} />
          <div className="min-w-0 leading-tight">
            <Link
              className="block truncate font-medium underline-offset-4 hover:underline"
              to={row.original.id}
              state={{ listSearch: search }}
              onClick={(event) => event.stopPropagation()}
            >
              <bdi>{row.original.name}</bdi>
            </Link>
            <bdi dir="ltr" className="tnum block truncate text-xs text-fg-3">
              {row.original.code}
            </bdi>
          </div>
        </div>
      ),
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
      cell: ({ row }) => <PeriodCell campaign={row.original} language={i18n.resolvedLanguage} />,
    },
    {
      id: 'client',
      header: t('admin.client'),
      cell: ({ row }) => <bdi>{row.original.client?.name}</bdi>,
    },
    {
      accessorKey: 'requiredAnimateurs',
      header: t('campaigns.requiredAnimateurs'),
      meta: { numeric: true },
      cell: ({ getValue }) => (getValue() > 0 ? num(getValue()) : '—'),
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
      <ListToolbar
        search={{
          label: t('admin.search'),
          value: filters.q,
          onChange: (value) => setFilter('q', value),
        }}
        filters={[
          {
            name: 'status',
            label: t('admin.status'),
            value: filters.status,
            options: CAMPAIGN_STATUSES.map((status) => ({
              value: status,
              label: t('campaigns.status.' + status),
            })),
            onChange: (value) => setFilter('status', value),
          },
          ...(canReadClients
            ? [
                {
                  name: 'client',
                  label: t('admin.client'),
                  value: filters.clientId,
                  options: clients.options,
                  onChange: (value) => setFilter('clientId', value),
                },
              ]
            : []),
          {
            name: 'wilaya',
            label: t('admin.wilaya'),
            value: filters.wilayaId,
            options: areaOptions(wilayas.data?.data, i18n.resolvedLanguage),
            onChange: (value) => setFilter('wilayaId', value),
          },
        ]}
        columns={{
          all: columns
            .filter((column) => column.header)
            .map((column) => ({ id: column.accessorKey ?? column.id, label: column.header })),
          ...columnState,
        }}
      >
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
      </ListToolbar>
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
        hidden={columnState.hidden}
        rowActions={(row) => (
          <Link
            to={row.id}
            state={{ listSearch: search }}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-2 hover:bg-sunken hover:text-fg"
          >
            {tp('list.open')}
            <ArrowUpRight aria-hidden="true" size={12} className="rtl:-scale-x-100" />
          </Link>
        )}
      />
    </>
  );
}
