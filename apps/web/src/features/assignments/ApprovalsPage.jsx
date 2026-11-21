import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { PageHeader, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { EmptyState } from '../../ui/data.jsx';
import { Avatar, Button, Skeleton } from '../../ui/primitives.jsx';
import { Ago, Section } from '../../ui/viz.jsx';
import { useWilayaName } from '../reporting/useWilayaName.js';
import { usePendingAssignments } from './api.js';
import { StockApprovals } from '../inventory/StockApprovals.jsx';
import { DecisionDialog } from './DecisionDialog.jsx';

export function ApprovalsPage() {
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
  const allowed = useCan('assignment.approve');
  const wilayaName = useWilayaName();
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
      <PageHeader
        title={t('admin.approvals')}
        context={query.isSuccess ? tp('approvals.context', { n: total }) : undefined}
      />
      {selection.length > 0 && (
        <div
          role="region"
          aria-label={tp('list.selected', { n: selection.length })}
          className="sticky top-0 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent-line bg-accent-soft px-3 py-2 text-sm"
        >
          <span className="font-medium">{tp('list.selected', { n: selection.length })}</span>
          <Button size="sm" variant="primary" onClick={() => setAction('approve')}>
            {t('assignments.approve')}
          </Button>
          <Button size="sm" onClick={() => setAction('reject')}>
            {t('assignments.reject')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => select([])}>
            {tp('list.clearSelection')}
          </Button>
        </div>
      )}
      {query.isPending && (
        <div role="status" className="space-y-2">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      )}
      {message && <Toast error message={message} />}
      {query.isSuccess && !rows.length && (
        <EmptyState title={tp('approvals.emptyTitle')} message={tp('approvals.empty')} />
      )}
      <div className="space-y-6">
        {Array.from(groups, ([key, group]) => (
          <Section
            key={key}
            title={
              <>
                <Link
                  className="hover:underline"
                  to={'/app/campaigns/' + group[0].campaignId + '?tab=assignments'}
                >
                  <bdi>{group[0].campaign.name}</bdi>
                </Link>
                <span className="font-normal text-fg-3">
                  {' · '}
                  {wilayaName(group[0].pointOfSale.wilayaId)}
                </span>
              </>
            }
          >
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {group.map((row) => (
                <li key={row.id}>
                  <label className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-sunken/60">
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
                    <Avatar name={row.animateur.fullName} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <strong className="block truncate font-medium">
                        <bdi>{row.animateur.fullName}</bdi>
                      </strong>
                      <span className="block truncate text-xs text-fg-3">
                        <bdi>{row.pointOfSale.name}</bdi>
                      </span>
                    </span>
                    <bdi className="tnum text-xs text-fg-2">
                      {row.startDate} – {row.endDate}
                    </bdi>
                    {row.createdAt && (
                      <span className="w-24 text-end text-xs text-fg-3">
                        <Ago at={row.createdAt} />
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </Section>
        ))}
      </div>
      <div className="mt-4 flex gap-3">
        <Button
          disabled={page <= 1}
          onClick={() => {
            select([]);
            setFilter('page', page - 1);
          }}
        >
          {t('admin.previous')}
        </Button>
        <Button
          disabled={page * pageSize >= total}
          onClick={() => {
            select([]);
            setFilter('page', page + 1);
          }}
        >
          {t('admin.next')}
        </Button>
      </div>
      <StockApprovals />
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
