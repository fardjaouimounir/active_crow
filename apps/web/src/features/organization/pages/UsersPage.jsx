import { USER_ROLES, USER_STATUSES } from '@fieldflow/shared';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { FilterBar, useFilters } from '../../../shared/ui/FilterBar.jsx';
import { FormField, SearchSelect } from '../../../shared/ui/FormControls.jsx';
import { PageHeader, StatusBadge } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useManagers, useOrganizationResource, useWilayas } from '../api.js';
import { InputField, SelectField, areaOptions, primaryStyle } from '../components/Fields.jsx';

const managerRoles = USER_ROLES.filter((role) => role !== 'animateur' && role !== 'client');
const useListManagers = (q) => useManagers(q, managerRoles);

export function UsersPage() {
  const { t, i18n } = useTranslation('common');
  const canCreate = useCan('org.user.manage');
  const { filters, setFilter } = useFilters();
  const navigate = useNavigate();
  const { search } = useLocation();
  const users = useOrganizationResource('/users', filters, { keepPrevious: true });
  const wilayas = useWilayas();
  const { message } = useApiError(users.error ?? wilayas.error);
  const sort = filters.sort ?? 'fullName:asc';
  const columns = [
    {
      accessorKey: 'fullName',
      header: t('admin.fullName'),
      meta: { sortable: true },
      cell: ({ row }) => (
        <Link
          className="font-medium underline-offset-4 hover:underline"
          to={row.original.id}
          state={{ listSearch: search }}
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.fullName}
        </Link>
      ),
    },
    {
      accessorKey: 'email',
      header: t('admin.email'),
      cell: ({ getValue }) => <bdi dir="ltr">{getValue()}</bdi>,
    },
    {
      accessorKey: 'role',
      header: t('admin.role'),
      cell: ({ getValue }) => t('roles.' + getValue()),
    },
    {
      accessorKey: 'status',
      header: t('admin.status'),
      cell: ({ getValue }) => (
        <StatusBadge tone={getValue() === 'active' ? 'good' : 'neutral'}>
          {t('admin.' + getValue())}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('admin.createdAt'),
      meta: { sortable: true },
      cell: ({ getValue }) =>
        new Intl.DateTimeFormat(i18n.resolvedLanguage, {
          timeZone: 'Africa/Algiers',
          dateStyle: 'medium',
        }).format(new Date(getValue())),
    },
  ];
  return (
    <>
      <PageHeader title={t('admin.users')}>
        {canCreate && (
          <Link className={primaryStyle} to="new">
            {t('admin.newUser')}
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
          name="role"
          value={filters.role}
          blank="all"
          options={USER_ROLES.map((value) => ({ value, label: t('roles.' + value) }))}
          onChange={(value) => setFilter('role', value)}
        />
        <SelectField
          name="status"
          value={filters.status}
          blank="all"
          options={USER_STATUSES.map((value) => ({ value, label: t('admin.' + value) }))}
          onChange={(value) => setFilter('status', value)}
        />
        <SelectField
          name="wilaya"
          value={filters.wilayaId}
          blank="all"
          options={areaOptions(wilayas.data?.data, i18n.resolvedLanguage)}
          onChange={(value) => setFilter('wilayaId', value)}
        />
        <FormField label={t('admin.manager')}>
          {(props) => (
            <SearchSelect
              {...props}
              value={filters.managerId}
              useOptions={useListManagers}
              onChange={(value) => setFilter('managerId', value)}
            />
          )}
        </FormField>
      </FilterBar>
      <DataTable
        columns={columns}
        rows={users.data?.data ?? []}
        {...users.data?.meta}
        page={Number(filters.page) || 1}
        sort={sort}
        error={message}
        loading={users.isPending || users.isPlaceholderData}
        onSort={(value) => setFilter('sort', value)}
        onPage={(value) => setFilter('page', value)}
        onRowClick={(row) => navigate(row.id, { state: { listSearch: search } })}
      />
    </>
  );
}
