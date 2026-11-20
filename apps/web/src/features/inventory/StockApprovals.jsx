import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { EmptyState } from '../../shared/ui/PageParts.jsx';
import { actionStyle } from '../organization/components/Fields.jsx';
import { useMyStock } from './api.js';
import { DecideDialog, ResolveDialog } from './StockForms.jsx';
import { locationName, MovementStatus } from './StockViews.jsx';

/** Disputes to resolve and adjustments to decide, for the Approvals page. */
export function StockApprovals() {
  const { t } = useTranslation('common');
  const allowed = useCan('inventory.adjust.approve');
  const query = useMyStock(allowed);
  const [dialog, setDialog] = useState(null);
  if (!allowed || !query.data) return null;
  const { adjustments, disputes } = query.data.data.approvals;
  const rows = [
    ...disputes.map((movement) => ({ movement, kind: 'dispute' })),
    ...adjustments.map((movement) => ({ movement, kind: 'adjustment' })),
  ];
  return (
    <section aria-labelledby="stock-approvals" className="mt-8 grid gap-3">
      <h2 id="stock-approvals" className="text-lg font-semibold">
        {t('stock.approvals.title')}
      </h2>
      {!rows.length && <EmptyState />}
      <ul className="grid gap-2">
        {rows.map(({ movement, kind }) => (
          <li
            key={movement.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3 text-sm"
          >
            <Link className="underline" to={`/app/campaigns/${movement.campaign.id}?tab=stock`}>
              {movement.campaign.name}
            </Link>
            <strong>
              {t('stock.approvals.' + (kind === 'dispute' ? 'disputes' : 'adjustments'))}
            </strong>
            <MovementStatus status={movement.status} />
            <span>
              {locationName(movement.from, t)} → {locationName(movement.to, t)}
            </span>
            <span>
              {movement.lines
                .map((line) =>
                  kind === 'dispute'
                    ? `${line.name} ×${line.quantity - (line.quantityReceived ?? 0)}`
                    : `${line.name} ×${line.quantity}`,
                )
                .join(', ')}
            </span>
            <span className="ms-auto flex gap-2">
              {kind === 'dispute' ? (
                <button
                  type="button"
                  className={actionStyle}
                  onClick={() => setDialog({ movement, action: 'resolve' })}
                >
                  {t('stock.actions.resolve')}
                </button>
              ) : (
                ['approve', 'reject'].map((action) => (
                  <button
                    key={action}
                    type="button"
                    className={actionStyle}
                    onClick={() => setDialog({ movement, action })}
                  >
                    {t('stock.actions.' + action)}
                  </button>
                ))
              )}
            </span>
          </li>
        ))}
      </ul>
      {dialog?.action === 'resolve' && (
        <ResolveDialog movement={dialog.movement} onClose={() => setDialog(null)} />
      )}
      {dialog && dialog.action !== 'resolve' && (
        <DecideDialog
          movement={dialog.movement}
          decision={dialog.action}
          onClose={() => setDialog(null)}
        />
      )}
    </section>
  );
}
