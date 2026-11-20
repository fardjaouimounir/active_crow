import { confirmBody } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useFieldQuery } from './api.js';
import {
  Availability,
  PendingSubmission,
  QueryState,
  card,
  control,
  fieldTime,
  primary,
  secondary,
  useField,
} from './ui.jsx';
import { useFieldSubmit } from './useFieldSubmit.js';

function StockForm({ movement, onSubmit, busy, close }) {
  const { t } = useTranslation('field');
  const {
    control: formControl,
    register,
    handleSubmit,
  } = useForm({
    resolver: zodResolver(confirmBody),
    defaultValues: {
      lines: movement.lines.map((line) => ({
        stockItemId: line.stockItemId,
        quantityReceived: line.quantity,
      })),
    },
  });
  const received = useWatch({ control: formControl, name: 'lines' });
  const short = movement.lines.some(
    (line, index) => received[index]?.quantityReceived < line.quantity,
  );
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="grid gap-3">
      <h3 className="font-semibold">{movement.campaign?.name ?? t('stock')}</h3>
      {movement.lines.map((line, index) => (
        <label className="grid gap-1" key={line.stockItemId}>
          {line.name} · {t('sentQuantity', { quantity: line.quantity })}
          <input
            className={control}
            type="number"
            inputMode="numeric"
            min={0}
            max={line.quantity}
            required
            {...register(`lines.${index}.quantityReceived`, { valueAsNumber: true })}
          />
        </label>
      ))}
      {short && (
        <p role="status" className="rounded-lg bg-amber-100 p-3 text-amber-950">
          {t('disputeWarning')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button className={primary} disabled={busy}>
          {t('confirmStock')}
        </button>
        <button className={secondary} type="button" onClick={close}>
          {t('cancel')}
        </button>
      </div>
    </form>
  );
}

export function Today() {
  const { t, i18n } = useTranslation('field');
  const { sale, field, attendance, current, install, installApp } = useField();
  const stock = useFieldQuery('/me/stock');
  const { hash } = useLocation();
  const [selected, select] = useState(null);
  const [notice, setNotice] = useState(null);
  const confirmation = useFieldSubmit('stock', (row) => {
    select(null);
    setNotice(row.status === 'disputed' ? 'disputeCreated' : 'stockConfirmed');
  });
  const delivery = useFieldSubmit('delivery', () => setNotice('delivered'));
  useEffect(() => {
    if (hash && stock.isSuccess && sale.isSuccess) {
      document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'center' });
    }
  }, [hash, stock.isSuccess, sale.isSuccess]);
  const count = sale.data?.data;
  const next = current?.checkpoints.find((checkpoint) => checkpoint.isOpen && !checkpoint.record);
  const incoming = stock.data?.data?.awaitingConfirmation ?? [];
  const active = incoming.find((row) => row.id === selected);
  return (
    <>
      <h1 className="text-2xl font-bold">{t('today')}</h1>
      {install && (
        <section className={card}>
          <p>{t('installHelp')}</p>
          <button className={primary} onClick={installApp}>
            {t('install')}
          </button>
        </section>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-teal-100 p-3 text-teal-950">
          {t(notice)}
        </p>
      )}
      {field ? (
        <section className={card}>
          <h2 className="text-lg font-bold">{field.pointOfSale.name}</h2>
          {field.pointOfSale.address && <p>{field.pointOfSale.address}</p>}
          {field.shiftStart && (
            <p>
              {t('shift')}{' '}
              <bdi>
                {field.shiftStart}–{field.shiftEnd}
              </bdi>
            </p>
          )}
          {field.closedReason ? (
            <p className="text-amber-900">{t('closed.' + field.closedReason)}</p>
          ) : (
            <>
              <QueryState query={attendance} />
              {current?.checkpoints.map((item) => (
                <div className="flex justify-between gap-2 border-b pb-2" key={item.code}>
                  <span>{item.label[i18n.resolvedLanguage] ?? item.label.en}</span>
                  <strong>
                    {item.record
                      ? t(
                          item.record.status === 'rejected'
                            ? 'rejected'
                            : item.isLate
                              ? 'late'
                              : 'done',
                        )
                      : item.isOpen
                        ? t('openNow')
                        : t('opensAt', { time: fieldTime(item.opensAt, i18n.language) })}
                  </strong>
                </div>
              ))}
              {next && (
                <Link to={'/field/attendance?checkpoint=' + next.code} className={primary}>
                  {t('recordCheckpoint')}
                </Link>
              )}
            </>
          )}
        </section>
      ) : (
        <Availability query={sale} next={count?.nextAssignmentDate} />
      )}
      {count && (
        <section className={card}>
          <h2 className="text-lg font-bold">{t('counters')}</h2>
          <dl className="grid grid-cols-2 gap-3">
            {[
              ['salesCount', count.salesCount],
              ['units', count.units],
              ['giftsDelivered', count.giftsDelivered],
              [
                'interactions',
                Object.values(count.interactions ?? {}).reduce((sum, value) => sum + value, 0),
              ],
            ].map(([label, value]) => (
              <div className="rounded-xl bg-slate-100 p-3" key={label}>
                <dt>{t(label)}</dt>
                <dd className="text-2xl font-bold tabular-nums">{value ?? 0}</dd>
              </div>
            ))}
          </dl>
          {field && !field.closedReason && (
            <Link className={primary} to="/field/sale">
              {t('newSale')}
            </Link>
          )}
        </section>
      )}
      <section className={card} id="stock">
        <h2 className="text-lg font-bold">{t('stock')}</h2>
        <QueryState query={stock} />
        <PendingSubmission write={confirmation}>
          {confirmation.pending?.body.lines?.map((line, index) => (
            <p key={line.stockItemId}>
              {t('pendingReceiptLine', { line: index + 1, quantity: line.quantityReceived })}
            </p>
          ))}
        </PendingSubmission>
        {stock.isSuccess && !incoming.length && !confirmation.pending && <p>{t('noStock')}</p>}
        {incoming.map((movement) =>
          active?.id === movement.id && !confirmation.pending ? (
            <StockForm
              key={movement.id}
              movement={movement}
              close={() => select(null)}
              busy={confirmation.busy}
              onSubmit={(body) =>
                confirmation.submit({
                  path: `/stock/transfers/${movement.id}/confirm`,
                  body,
                })
              }
            />
          ) : (
            <button
              key={movement.id}
              className={secondary}
              disabled={Boolean(confirmation.pending)}
              onClick={() => select(movement.id)}
            >
              {movement.campaign?.name ?? t('stock')} · {t('reviewReceipt')}
            </button>
          ),
        )}
      </section>
      {(count || delivery.pending || delivery.problem) && (
        <section className={card} id="undelivered">
          <h2 className="text-lg font-bold">{t('giftBalances')}</h2>
          {count?.giftBalances?.flatMap((group) =>
            group.items.map((item) => (
              <p key={group.locationId + item.stockItemId}>
                {item.name} · <strong>{item.quantity}</strong>
              </p>
            )),
          )}
          <h2 className="text-lg font-bold">{t('undelivered')}</h2>
          <PendingSubmission write={delivery} />
          {count && !count.undelivered?.length && <p>{t('noUndelivered')}</p>}
          {count?.undelivered?.flatMap((group) =>
            group.entitlements.map((item) => (
              <div className="flex items-center justify-between gap-2" key={item.id}>
                <span>
                  {group.stockItem.name} × {item.quantity}
                </span>
                <button
                  className={secondary}
                  disabled={Boolean(delivery.pending)}
                  onClick={() =>
                    delivery.submit({ path: `/entitlements/${item.id}/deliver`, body: {} })
                  }
                >
                  {t('deliver')}
                </button>
              </div>
            )),
          )}
        </section>
      )}
    </>
  );
}
