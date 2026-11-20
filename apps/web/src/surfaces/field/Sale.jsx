import {
  algerianMobileNumber,
  evaluatePromotions,
  fieldInteraction,
  fieldSaleBody,
} from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import {
  Availability,
  PendingSubmission,
  PhotoPicker,
  Stepper,
  card,
  control,
  primary,
  secondary,
  useField,
} from './ui.jsx';
import { useFieldSubmit } from './useFieldSubmit.js';

const kinds = ['sample', 'tasting', 'information'];
const blankSale = { items: [] };
const optional = (value) => value?.trim() || undefined;

function SaleResult({ row, close }) {
  const { t } = useTranslation('field');
  return (
    <section className={card} aria-live="polite">
      <h2 className="text-xl font-bold">{t('saleRecorded')}</h2>
      {['distributed', 'undelivered'].map((status) => {
        const items = row.entitlements?.filter((item) => item.status === status) ?? [];
        if (!items.length) return null;
        return (
          <div
            key={status}
            className={
              status === 'distributed'
                ? 'rounded-xl bg-success-soft p-3'
                : 'rounded-xl bg-warning-soft p-3'
            }
          >
            <h3 className="font-bold">
              {t(status === 'distributed' ? 'handOver' : 'undelivered')}
            </h3>
            {items.map((item) => (
              <p key={item.id}>
                {item.stockItem.name} × {item.quantity}
              </p>
            ))}
            {status === 'undelivered' && <p>{t('outOfStock')}</p>}
          </div>
        );
      })}
      {row.tombolaEntries?.map((entry) => (
        <div key={entry.tombolaId ?? entry.tombola}>
          <h3 className="font-bold">{entry.tombola}</h3>
          <p className="break-words text-3xl font-bold tabular-nums" dir="ltr">
            {entry.numbers.join(' · ')}
          </p>
        </div>
      ))}
      {row.skippedPromotions?.map((entry) => (
        <p key={entry.promotionId}>{t('limitReached')}</p>
      ))}
      <button type="button" className={primary} onClick={close}>
        {t('newSale')}
      </button>
    </section>
  );
}

function SaleForm({ field, write }) {
  const { t } = useTranslation('field');
  const [photo, setPhoto] = useState(null);
  const [processing, setProcessing] = useState(false);
  const required = field.customerFields ?? {};
  const formSchema = fieldSaleBody.superRefine(({ customer }, context) => {
    for (const name of ['fullName', 'phone']) {
      if (required[name] === 'required' && !customer?.[name]) {
        context.addIssue({ code: 'custom', path: ['customer', name], message: 'required' });
      }
    }
    if (required.consentRequired && !customer?.consentTombola)
      context.addIssue({
        code: 'custom',
        path: ['customer', 'consentTombola'],
        message: 'required',
      });
    if (customer?.phone && !algerianMobileNumber(customer.phone))
      context.addIssue({ code: 'custom', path: ['customer', 'phone'], message: 'phoneInvalid' });
  });
  const {
    control: formControl,
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: write.pending?.body ?? blankSale,
  });
  const items = useWatch({ control: formControl, name: 'items' });
  const quantities = new Map(items.map(({ productId, quantity }) => [productId, quantity]));
  const gifts = evaluatePromotions(field.promotions ?? [], items);
  const disabled = write.busy || Boolean(write.pending);
  function select(productId, quantity) {
    const updated = items.filter((item) => item.productId !== productId);
    if (quantity) updated.push({ productId, quantity });
    setValue('items', updated);
  }
  return (
    <form
      className="grid gap-4"
      onSubmit={handleSubmit((body) =>
        write.submit({
          path: `/assignments/${field.assignmentId}/sales`,
          body,
          file: photo,
          fileField: 'proof',
        }),
      )}
    >
      <fieldset className="grid gap-4" disabled={disabled}>
        <section className={card}>
          <h2 className="text-lg font-bold">{t('products')}</h2>
          {field.products?.map((product) => (
            <div
              className="flex items-center justify-between gap-2 rounded-xl bg-sunken p-2"
              key={product.id}
            >
              <strong className="min-w-0 break-words">{product.name}</strong>
              <Stepper
                name={product.name}
                value={quantities.get(product.id) ?? 0}
                max={items.length >= 20 && !quantities.has(product.id) ? 0 : 1000}
                onChange={(quantity) => select(product.id, quantity)}
              />
            </div>
          ))}
        </section>
        {gifts.length > 0 && (
          <section className={card + ' bg-success-soft'}>
            <h2 className="font-bold">{t('expectedGifts')}</h2>
            <p>{t('previewOnly')}</p>
            {gifts.map((gift) => (
              <p key={gift.promotionId}>
                {field.stockItems?.find(({ id }) => id === gift.stockItemId)?.name ??
                  field.promotions.find(({ id }) => id === gift.promotionId)?.name}{' '}
                × {gift.quantity}
              </p>
            ))}
          </section>
        )}
        <section className={card}>
          <h2 className="font-bold">{t('customer')}</h2>
          {['fullName', 'phone']
            .filter((name) => required[name] !== 'hidden')
            .map((name) => (
              <label className="grid gap-1" key={name}>
                {t(name)}
                {required[name] === 'required' ? ' *' : ''}
                <input
                  className={control}
                  type={name === 'phone' ? 'tel' : 'text'}
                  inputMode={name === 'phone' ? 'tel' : 'text'}
                  dir={name === 'phone' ? 'ltr' : undefined}
                  placeholder={name === 'phone' ? '05 50 12 34 56' : undefined}
                  autoComplete="off"
                  {...register('customer.' + name, { setValueAs: optional })}
                />
                {errors.customer?.[name] && (
                  <span role="alert" className="text-danger">
                    {t(
                      errors.customer[name].message === 'phoneInvalid'
                        ? 'phoneInvalid'
                        : 'customerRequired',
                    )}
                  </span>
                )}
              </label>
            ))}
          <label className="flex min-h-12 items-center gap-3">
            <input
              className="size-6 shrink-0"
              type="checkbox"
              {...register('customer.consentTombola')}
            />
            {t('consent')}
            {required.consentRequired ? ' *' : ''}
          </label>
          {errors.customer?.consentTombola && (
            <p role="alert" className="text-danger">
              {t('customerRequired')}
            </p>
          )}
          <label className="grid gap-1">
            {t('invoice')}
            <input
              className={control}
              maxLength={60}
              {...register('invoiceRef', { setValueAs: optional })}
            />
          </label>
          <PhotoPicker file={photo} onChange={setPhoto} onProcessing={setProcessing} />
        </section>
        <button className={primary} disabled={!items.length || disabled || processing}>
          {t(write.busy ? 'sending' : 'submitSale')}
        </button>
      </fieldset>
    </form>
  );
}

function InteractionForm({ field, write, saved }) {
  const { t } = useTranslation('field');
  const {
    control: formControl,
    register,
    setValue,
    handleSubmit,
  } = useForm({
    resolver: zodResolver(fieldInteraction),
    defaultValues: write.pending?.body ?? { kind: 'sample', count: 1 },
  });
  const count = useWatch({ control: formControl, name: 'count' });
  return (
    <form
      className={card}
      onSubmit={handleSubmit((body) =>
        write.submit({ path: `/assignments/${field.assignmentId}/interactions`, body }),
      )}
    >
      <fieldset className="grid gap-3" disabled={write.busy || Boolean(write.pending)}>
        <p>{t('interactionHelp')}</p>
        {saved && <p role="status">{t('interactionRecorded')}</p>}
        <label className="grid gap-1">
          {t('interactionKind')}
          <select className={control} {...register('kind')}>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {t(kind)}
              </option>
            ))}
          </select>
        </label>
        <Stepper
          name={t('interactionCount')}
          value={count}
          min={1}
          max={500}
          onChange={(value) => setValue('count', value)}
        />
        <button className={primary}>{t(write.busy ? 'sending' : 'submitInteraction')}</button>
      </fieldset>
    </form>
  );
}

export function Sale() {
  const { t } = useTranslation('field');
  const { field, sale } = useField();
  const [query, setQuery] = useSearchParams();
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(0);
  const write = useFieldSubmit('sale', setResult);
  const interaction = useFieldSubmit('interaction', () => setSaved((previous) => previous + 1));
  const counting = query.get('view') === 'interaction';
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">{t('sale')}</h1>
      <div className="grid grid-cols-2 gap-2">
        <button
          className={counting ? secondary : primary}
          aria-pressed={!counting}
          onClick={() => setQuery({})}
        >
          {t('newSale')}
        </button>
        <button
          className={counting ? primary : secondary}
          aria-pressed={counting}
          onClick={() => setQuery({ view: 'interaction' })}
        >
          {t('noPurchase')}
        </button>
      </div>
      <PendingSubmission write={counting ? interaction : write} />
      {!counting && result ? (
        <SaleResult row={result} close={() => setResult(null)} />
      ) : !field || field.closedReason ? (
        <Availability query={sale} field={field} next={sale.data?.data.nextAssignmentDate} />
      ) : counting ? (
        <InteractionForm key={saved} field={field} write={interaction} saved={saved} />
      ) : (
        <SaleForm field={field} write={write} />
      )}
    </>
  );
}
