import { today } from '@fieldflow/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useFilters } from '../../../shared/ui/FilterBar.jsx';
import { DatePicker, FormField } from '../../../shared/ui/FormControls.jsx';
import { EmptyState, PageHeader, StatusBadge, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useOrganizationResource } from '../api.js';

function Tree({ nodes }) {
  const { t } = useTranslation('common');
  return (
    <ul className="space-y-2">
      {nodes.map((node) => {
        const label = (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Link
              to={'/app/users/' + node.id}
              className="font-medium underline-offset-4 hover:underline"
            >
              {node.fullName}
            </Link>
            <StatusBadge>{t('roles.' + node.role)}</StatusBadge>
          </span>
        );
        return (
          <li key={node.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            {node.children.length ? (
              <details open>
                <summary className="cursor-pointer">{label}</summary>
                <div className="mt-2 border-s border-line ps-3">
                  <Tree nodes={node.children} />
                </div>
              </details>
            ) : (
              label
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function OrganizationPage() {
  const { t } = useTranslation('common');
  const { filters, setFilter } = useFilters();
  const at = filters.at ?? today();
  const tree = useOrganizationResource('/organization/tree', { at });
  const { message } = useApiError(tree.error);
  return (
    <>
      <PageHeader title={t('admin.organization')} />
      <div className="mb-4 max-w-xs">
        <FormField label={t('admin.viewDate')}>
          {(props) => (
            <DatePicker
              {...props}
              max={today()}
              value={at}
              onChange={(event) => setFilter('at', event.target.value)}
            />
          )}
        </FormField>
      </div>
      {tree.isPending && <p role="status">{t('admin.loading')}</p>}
      {message && <Toast error message={message} />}
      {tree.data?.data.length === 0 && <EmptyState />}
      {tree.data?.data.length > 0 && <Tree nodes={tree.data.data} />}
    </>
  );
}
