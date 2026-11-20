import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { Modal } from '../../../shared/ui/Dialogs.jsx';
import { FilterBar, useFilters } from '../../../shared/ui/FilterBar.jsx';
import { PageHeader } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { InputField, primaryStyle } from '../../organization/components/Fields.jsx';
import { useClients } from '../api.js';
import { ClientForm } from '../components/ClientForm.jsx';

export function ClientsPage() {
  const { t, i18n } = useTranslation('common');
  const manage = useCan('catalog.manage');
  const navigate = useNavigate();
  const { search } = useLocation();
  const { filters, setFilter } = useFilters();
  const clients = useClients(filters);
  const { message } = useApiError(clients.error);
  const [creating, setCreating] = useState(false);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const count = (key) => ({
    id: key,
    header: t('catalog.counts.' + key),
    cell: ({ row }) => number.format(row.original.counts[key]),
  });
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
      accessorKey: 'contactName',
      header: t('admin.contactName'),
      cell: ({ getValue }) => getValue() ?? '—',
    },
    count('products'),
    count('stockItems'),
    count('portalUsers'),
  ];
  return (
    <>
      <PageHeader title={t('admin.clients')}>
        {manage && (
          <button type="button" className={primaryStyle} onClick={() => setCreating(true)}>
            {t('catalog.newClient')}
          </button>
        )}
      </PageHeader>
      <FilterBar>
        <InputField
          name="search"
          type="search"
          value={filters.q}
          onChange={(value) => setFilter('q', value)}
        />
      </FilterBar>
      <DataTable
        columns={columns}
        rows={clients.data?.data ?? []}
        {...clients.data?.meta}
        page={Number(filters.page) || 1}
        sort={filters.sort ?? 'name:asc'}
        loading={clients.isPending || clients.isPlaceholderData}
        error={message}
        onSort={(value) => setFilter('sort', value)}
        onPage={(value) => setFilter('page', value)}
        onRowClick={(row) => navigate(row.id, { state: { listSearch: search } })}
      />
      {creating && (
        <Modal title={t('catalog.newClient')} onClose={() => setCreating(false)}>
          <ClientForm onSuccess={(client) => navigate(client.id)} />
        </Modal>
      )}
    </>
  );
}
