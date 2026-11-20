import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { EmptyState, PageHeader, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useStockWrite, useIdempotencyKey, useMyStock } from './api.js';
import { actionStyle } from '../organization/components/Fields.jsx';
import { AdjustmentDialog, ConfirmTransferDialog } from './StockForms.jsx';
import { locationName, MovementStatus } from './StockViews.jsx';

function CancelButton({ movement }) {
  const { t } = useTranslation('common');
  const idempotency = useIdempotencyKey();
  const mutation = useStockWrite(idempotency);
  const { message } = useApiError(mutation.error);
  return (
    <>
      <button
        type="button"
        className={actionStyle}
        disabled={mutation.isPending}
        onClick={() =>
          mutation.mutate({ path: `/stock/transfers/${movement.id}/cancel`, body: {} })
        }
      >
        {t('stock.actions.cancel')}
      </button>
      <Toast error message={message} />
    </>
  );
}

function ShipmentRow({ movement, children }) {
  const { t } = useTranslation('common');
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-3 text-sm">
      <Link className="underline" to={`/app/campaigns/${movement.campaign.id}?tab=stock`}>
        {movement.campaign.name}
      </Link>
      <strong>{t('stock.types.' + movement.type)}</strong>
      <MovementStatus status={movement.status} />
      <span>
        {locationName(movement.from, t)} → {locationName(movement.to, t)}
      </span>
      <span>{movement.lines.map((line) => `${line.name} ×${line.quantity}`).join(', ')}</span>
      <span className="ms-auto">{children}</span>
    </li>
  );
}

/** Balances, shipments waiting for me, my own pending shipments, and a way to request an adjustment. */
export function MyStockPage() {
  const { t, i18n } = useTranslation('common');
  const allowed = useCan('inventory.read');
  const query = useMyStock(allowed);
  const { message } = useApiError(query.error);
  const [confirming, setConfirming] = useState(null);
  const [adjusting, setAdjusting] = useState(null);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  if (!allowed) return <Toast error message={t('errors.codes.FORBIDDEN')} />;
  const data = query.data?.data;
  return (
    <>
      <PageHeader title={t('stock.myStock')} />
      {query.isPending && <p role="status">{t('admin.loading')}</p>}
      <Toast error message={message} />
      {data && (
        <div className="grid gap-6">
          <section aria-labelledby="my-balances" className="grid gap-3">
            <h2 id="my-balances" className="font-semibold">
              {t('stock.mine.balances')}
            </h2>
            {!data.balances.length && <EmptyState />}
            {data.balances.map((entry) => (
              <div key={entry.locationId} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    className="font-medium underline"
                    to={`/app/campaigns/${entry.campaign.id}?tab=stock`}
                  >
                    {entry.campaign.name}
                  </Link>
                  {entry.kind === 'holder' && (
                    <button
                      type="button"
                      className={actionStyle}
                      onClick={() => setAdjusting(entry.campaign)}
                    >
                      {t('stock.actions.adjust')}
                    </button>
                  )}
                </div>
                <ul className="mt-2 grid gap-1 text-sm">
                  {entry.items.map((item) => (
                    <li key={item.stockItemId}>
                      {item.name}: <strong>{number.format(item.quantity)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          <section aria-labelledby="to-confirm" className="grid gap-3">
            <h2 id="to-confirm" className="font-semibold">
              {t('stock.mine.toConfirm')}
            </h2>
            {!data.awaitingConfirmation.length && <EmptyState />}
            <ul className="grid gap-2">
              {data.awaitingConfirmation.map((movement) => (
                <ShipmentRow key={movement.id} movement={movement}>
                  <button
                    type="button"
                    className={actionStyle}
                    onClick={() => setConfirming(movement)}
                  >
                    {t('stock.actions.confirm')}
                  </button>
                </ShipmentRow>
              ))}
            </ul>
          </section>
          <section aria-labelledby="outgoing" className="grid gap-3">
            <h2 id="outgoing" className="font-semibold">
              {t('stock.mine.outgoing')}
            </h2>
            {!data.outgoing.length && <EmptyState />}
            <ul className="grid gap-2">
              {data.outgoing.map((movement) => (
                <ShipmentRow key={movement.id} movement={movement}>
                  <CancelButton movement={movement} />
                </ShipmentRow>
              ))}
            </ul>
          </section>
        </div>
      )}
      {confirming && (
        <ConfirmTransferDialog movement={confirming} onClose={() => setConfirming(null)} />
      )}
      {adjusting && <AdjustmentDialog campaign={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}
