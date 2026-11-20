import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../shared/auth/hooks.js';
import { actionStyle } from '../organization/components/Fields.jsx';
import { AdjustmentDialog, ReturnDialog, StockInDialog, TransferDialog } from './StockForms.jsx';
import { BalancesView, MovementsView, ReconciliationView } from './StockViews.jsx';

const VIEWS = ['balances', 'movements', 'reconciliation'];

/** The campaign's Stock tab: balances matrix, movements and reconciliation, plus the actions. */
export function StockTab({ campaign }) {
  const { t } = useTranslation('common');
  const [view, setView] = useState('balances');
  const [dialog, setDialog] = useState(null);
  const can = {
    stockIn: useCan('inventory.stock_in'),
    transfer: useCan('inventory.transfer'),
    return: useCan('inventory.return'),
    adjust: useCan('inventory.adjust.request'),
  };
  const dialogs = {
    stockIn: StockInDialog,
    transfer: TransferDialog,
    return: ReturnDialog,
    adjust: AdjustmentDialog,
  };
  const Dialog = dialogs[dialog];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label={t('stock.tab')} className="flex gap-2">
          {VIEWS.map((name) => (
            <button
              key={name}
              type="button"
              className={actionStyle}
              aria-pressed={view === name}
              onClick={() => setView(name)}
            >
              {t('stock.views.' + name)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.keys(dialogs)
            .filter((name) => can[name])
            .map((name) => (
              <button
                key={name}
                type="button"
                className={actionStyle}
                onClick={() => setDialog(name)}
              >
                {t('stock.actions.' + name)}
              </button>
            ))}
        </div>
      </div>
      {view === 'balances' && <BalancesView campaignId={campaign.id} />}
      {view === 'movements' && <MovementsView campaignId={campaign.id} />}
      {view === 'reconciliation' && <ReconciliationView campaignId={campaign.id} />}
      {Dialog && <Dialog campaign={campaign} onClose={() => setDialog(null)} />}
    </div>
  );
}
