import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { FilterBar, useFilters } from '../../../shared/ui/FilterBar.jsx';
import { PageHeader } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useCommunes, useWilayas } from '../../organization/api.js';
import {
  InputField,
  SelectField,
  areaOptions,
  primaryStyle,
} from '../../organization/components/Fields.jsx';
import { usePointsOfSale } from '../api.js';

export function PointsPage() {
  const { t, i18n } = useTranslation('common');
  const manage = useCan('org.structure.manage');
  const navigate = useNavigate();
  const { search } = useLocation();
  const { filters, setFilter, setFilters } = useFilters();
  const points = usePointsOfSale(filters);
  const wilayas = useWilayas();
  const communes = useCommunes(filters.wilayaId);
  const { message } = useApiError(points.error ?? wilayas.error ?? communes.error);
  const areas = areaOptions(wilayas.data?.data, i18n.resolvedLanguage);
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
      cell: ({ getValue }) => <bdi>{getValue()}</bdi>,
    },
    { accessorKey: 'type', header: t('admin.type') },
    {
      accessorKey: 'wilayaId',
      header: t('admin.wilaya'),
      cell: ({ getValue }) => areas.find((item) => item.value === getValue())?.label ?? getValue(),
    },
  ];
  return (
    <>
      <PageHeader title={t('admin.points')}>
        {manage && (
          <Link to="new" className={primaryStyle}>
            {t('admin.newPoint')}
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
        <InputField
          name="type"
          value={filters.type}
          onChange={(value) => setFilter('type', value)}
        />
        <SelectField
          name="wilaya"
          blank="all"
          options={areas}
          value={filters.wilayaId}
          onChange={(value) => setFilters({ wilayaId: value, communeId: '' })}
        />
        <SelectField
          name="commune"
          blank="all"
          disabled={!filters.wilayaId}
          options={areaOptions(communes.data?.data, i18n.resolvedLanguage)}
          value={filters.communeId}
          onChange={(value) => setFilter('communeId', value)}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={points.data?.data ?? []}
        {...points.data?.meta}
        page={Number(filters.page) || 1}
        sort={filters.sort ?? 'name:asc'}
        loading={points.isPending || points.isPlaceholderData}
        error={message}
        onSort={(value) => setFilter('sort', value)}
        onPage={(value) => setFilter('page', value)}
        onRowClick={(row) => navigate(row.id, { state: { listSearch: search } })}
      />
    </>
  );
}
