import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog } from '../../../shared/ui/Dialogs.jsx';
import { useFilters } from '../../../shared/ui/FilterBar.jsx';
import { PageHeader, Toast } from '../../../shared/ui/PageParts.jsx';
import { Tabs } from '../../../shared/ui/Tabs.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { actionStyle } from '../../organization/components/Fields.jsx';
import { useCatalogWrite, useClient } from '../api.js';
import { CatalogItemsTab } from '../components/CatalogItemsTab.jsx';
import { ClientForm } from '../components/ClientForm.jsx';
import { PortalAccountsTab } from '../components/PortalAccountsTab.jsx';

function Overview({ client }) {
  const { t, i18n } = useTranslation('common');
  const manage = useCan('catalog.manage');
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mutation = useCatalogWrite();
  const { message } = useApiError(mutation.error);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-xl border border-line bg-surface p-5 lg:col-span-2">
        {saved && <Toast message={t('admin.saved')} />}
        <ClientForm
          key={client.updatedAt}
          client={client}
          disabled={!manage}
          onSuccess={() => setSaved(true)}
        />
      </section>
      <section className="rounded-xl border border-line bg-surface p-5">
        <dl className="grid gap-3 text-sm">
          {Object.entries(client.counts).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="font-medium">{t('catalog.counts.' + key)}</dt>
              <dd>{number.format(value)}</dd>
            </div>
          ))}
        </dl>
        {manage && (
          <button
            type="button"
            className={actionStyle + ' mt-4 text-danger'}
            onClick={() => setDeleting(true)}
          >
            {t('catalog.deleteClient')}
          </button>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title={t('catalog.deleteClient')}
          message={t('catalog.confirmDeleteClient', { name: client.name })}
          pending={mutation.isPending}
          onClose={() => {
            setDeleting(false);
            mutation.reset();
          }}
          onConfirm={() =>
            mutation.mutate(
              { method: 'delete', path: '/clients/' + client.id },
              { onSuccess: () => navigate('/app/clients', { replace: true }) },
            )
          }
        >
          <Toast error message={message} />
        </ConfirmDialog>
      )}
    </div>
  );
}

export function ClientDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { t } = useTranslation('common');
  const canReadUsers = useCan('org.user.read');
  const { filters, setFilters } = useFilters();
  const query = useClient(id);
  const { message } = useApiError(query.error);
  const tabs = ['overview', 'products', 'stockItems', ...(canReadUsers ? ['portal'] : [])];
  const tab = tabs.includes(filters.tab) ? filters.tab : 'overview';
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (query.isError) return <Toast error message={message} />;
  const client = query.data.data;
  return (
    <>
      <PageHeader title={client.name}>
        <Link
          className={actionStyle}
          to={{ pathname: '/app/clients', search: location.state?.listSearch ?? '' }}
        >
          {t('admin.clients')}
        </Link>
      </PageHeader>
      <Tabs
        label={client.name}
        value={tab}
        tabs={tabs.map((value) => ({ value, label: t('catalog.tabs.' + value) }))}
        onChange={(value) => setFilters({ tab: value, kind: '', sort: '' })}
      >
        {tab === 'overview' && <Overview client={client} />}
        {(tab === 'products' || tab === 'stockItems') && (
          <CatalogItemsTab key={tab} clientId={client.id} resource={tab} />
        )}
        {tab === 'portal' && <PortalAccountsTab clientId={client.id} />}
      </Tabs>
    </>
  );
}
