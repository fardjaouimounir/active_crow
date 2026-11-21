import { USER_ROLES, USER_STATUSES } from '@fieldflow/shared';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { useFilters } from '../../../shared/ui/FilterBar.jsx';
import { ListToolbar, useColumnVisibility } from '../../../shared/ui/ListToolbar.jsx';
import { FormField, SearchSelect } from '../../../shared/ui/FormControls.jsx';
import { PageHeader, StatusBadge } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useManagers, useOrganizationResource, useWilayas } from '../api.js';
import { areaOptions, primaryStyle } from '../components/Fields.jsx';
import { Avatar } from '../../../ui/primitives.jsx';

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
  const { t: tp } = useTranslation('pro');
  const columnState = useColumnVisibility('users');
  const columns = [
    {
      accessorKey: 'fullName',
      header: t('admin.fullName'),
      meta: { sortable: true, width: '32%' },
      cell: ({ row }) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={row.original.fullName} />
          <div className="min-w-0 leading-tight">
            <Link
              className="block truncate font-medium underline-offset-4 hover:underline"
              to={row.original.id}
              state={{ listSearch: search }}
              onClick={(event) => event.stopPropagation()}
            >
              <bdi>{row.original.fullName}</bdi>
            </Link>
            <bdi dir="ltr" className="block truncate text-xs text-fg-3">
              {row.original.email}
            </bdi>
          </div>
        </div>
      ),
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
      <ListToolbar
        search={{
          label: t('admin.search'),
          value: filters.q,
          onChange: (value) => setFilter('q', value),
        }}
        filters={[
          {
            name: 'role',
            label: t('admin.role'),
            value: filters.role,
            options: USER_ROLES.map((value) => ({ value, label: t('roles.' + value) })),
            onChange: (value) => setFilter('role', value),
          },
          {
            name: 'status',
            label: t('admin.status'),
            value: filters.status,
            options: USER_STATUSES.map((value) => ({ value, label: t('admin.' + value) })),
            onChange: (value) => setFilter('status', value),
          },
          {
            name: 'wilaya',
            label: t('admin.wilaya'),
            value: filters.wilayaId,
            options: areaOptions(wilayas.data?.data, i18n.resolvedLanguage),
            onChange: (value) => setFilter('wilayaId', value),
          },
        ]}
        columns={{
          all: columns.map((column) => ({ id: column.accessorKey, label: column.header })),
          ...columnState,
        }}
      >
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
      </ListToolbar>
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
        hidden={columnState.hidden}
        rowActions={(row) => (
          <Link
            to={row.id}
            state={{ listSearch: search }}
            className="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium text-fg-2 hover:bg-sunken hover:text-fg"
          >
            {tp('list.open')}
          </Link>
        )}
      />
    </>
  );
}
