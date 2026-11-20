import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { EmptyState, PageHeader, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { actionStyle } from '../organization/components/Fields.jsx';
import { usePendingAssignments } from './api.js';
import { DecisionDialog } from './DecisionDialog.jsx';

export function ApprovalsPage() {
  const { t } = useTranslation('common');
  const allowed = useCan('assignment.approve');
  const { filters, setFilter } = useFilters();
  const query = usePendingAssignments(filters.page ?? '1', allowed);
  const { message } = useApiError(query.error);
  const [selected, select] = useState([]);
  const [action, setAction] = useState(null);
  if (!allowed) return <Toast error message={t('errors.codes.FORBIDDEN')} />;
  const rows = query.data?.data ?? [];
  const { page = 1, pageSize = 25, total = 0 } = query.data?.meta ?? {};
  const selection = rows.filter(({ id }) => selected.includes(id));
  const groups = Map.groupBy(
    rows,
    ({ campaignId, pointOfSale }) => campaignId + ':' + pointOfSale.wilayaId,
  );
  return (
    <>
      <PageHeader title={t('admin.approvals')}>
        <div className="flex gap-2">
          {['approve', 'reject'].map((value) => (
            <button
              key={value}
              className={actionStyle}
              type="button"
              disabled={!selection.length}
              onClick={() => setAction(value)}
            >
              {t('assignments.' + value)}
            </button>
          ))}
        </div>
      </PageHeader>
      {query.isPending && <p role="status">{t('admin.loading')}</p>}
      {message && <Toast error message={message} />}
      {query.isSuccess && !rows.length && <EmptyState />}
      <div className="space-y-3">
        {Array.from(groups, ([key, group]) => (
          <section key={key} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="font-semibold">
              <Link
                className="underline"
                to={'/app/campaigns/' + group[0].campaignId + '?tab=assignments'}
              >
                {group[0].campaign.name}
              </Link>
              {' · '}
              {t('admin.wilaya')} {group[0].pointOfSale.wilayaId}
            </h2>
            <ul className="mt-3 grid gap-2">
              {group.map((row) => (
                <li key={row.id}>
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={(event) =>
                        select(
                          event.target.checked
                            ? [...selected, row.id]
                            : selected.filter((id) => id !== row.id),
                        )
                      }
                    />
                    <strong>{row.animateur.fullName}</strong>
                    <span>{row.pointOfSale.name}</span>
                    <bdi>
                      {row.startDate} – {row.endDate}
                    </bdi>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <button
          type="button"
          className={actionStyle}
          disabled={page <= 1}
          onClick={() => {
            select([]);
            setFilter('page', page - 1);
          }}
        >
          {t('admin.previous')}
        </button>
        <button
          type="button"
          className={actionStyle}
          disabled={page * pageSize >= total}
          onClick={() => {
            select([]);
            setFilter('page', page + 1);
          }}
        >
          {t('admin.next')}
        </button>
      </div>
      {action && (
        <DecisionDialog
          action={action}
          rows={selection}
          batch
          onClose={() => {
            setAction(null);
            select([]);
          }}
        />
      )}
    </>
  );
}
