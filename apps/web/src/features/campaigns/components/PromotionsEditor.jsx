import { PROMOTION_LIMITS, PROMOTION_TYPES, promotionsPayloadSchema } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { get, useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, Select, TextInput } from '../../../shared/ui/FormControls.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { actionStyle, primaryStyle } from '../../organization/components/Fields.jsx';
import { useCampaignWrite } from '../api.js';

const nullableNumber = {
  setValueAs: (value) => (value === '' || value == null ? null : Number(value)),
};
const nullableId = { setValueAs: (value) => (value === '' || value == null ? null : value) };
const integer = { valueAsNumber: true };

const emptyTier = (minQuantity = 1) => ({ minQuantity, stockItemId: '', giftQuantity: 1 });
const emptyPromotion = () => ({
  type: 'gift_with_purchase',
  name: '',
  productId: '',
  maxPerCustomer: '',
  tiers: [emptyTier(1)],
});

const toForm = (promotion) => ({
  type: promotion.type,
  name: promotion.name,
  productId: promotion.productId ?? '',
  maxPerCustomer: promotion.maxPerCustomer ?? '',
  tiers: promotion.tiers.map(({ minQuantity, stockItemId, giftQuantity }) => ({
    minQuantity,
    stockItemId,
    giftQuantity,
  })),
});

function Message({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {children}
    </p>
  );
}

function PromotionCard({ index, ctx, products, gifts, readOnly, onRemove }) {
  const { t } = useTranslation('common');
  const { control, register, getValues, fieldError } = ctx;
  const base = `promotions.${index}`;
  const type = useWatch({ control, name: `${base}.type` });
  const { fields, append, remove, replace } = useFieldArray({ control, name: `${base}.tiers` });
  const single = type === 'gift_with_purchase';

  // A gift with purchase is exactly one tier from 1 unit; a tiered gift needs at least two.
  const adjustTiers = (nextType) => {
    const current = getValues(`${base}.tiers`);
    if (nextType === 'gift_with_purchase') {
      replace([{ ...(current[0] ?? emptyTier()), minQuantity: 1 }]);
    } else if (current.length < PROMOTION_LIMITS.minTiers) {
      replace([...current, emptyTier((current.at(-1)?.minQuantity ?? 0) + 1)]);
    }
  };

  const scope = [{ value: '', label: t('rules.promotions.allProducts') }, ...products];
  return (
    <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <legend className="px-1 font-medium">
        {t('rules.promotions.promotion', { n: index + 1 })}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label={t('rules.promotions.type')} error={fieldError(`${base}.type`)}>
          {(input) => (
            <Select
              {...input}
              {...register(`${base}.type`, {
                onChange: (event) => adjustTiers(event.target.value),
              })}
            >
              {PROMOTION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t('rules.promotions.types.' + value)}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t('rules.promotions.name')} error={fieldError(`${base}.name`)}>
          {(input) => <TextInput {...input} {...register(`${base}.name`)} />}
        </FormField>
        <FormField label={t('rules.promotions.scope')} error={fieldError(`${base}.productId`)}>
          {(input) => (
            <Select {...input} {...register(`${base}.productId`, nullableId)}>
              {scope.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField
          label={t('rules.promotions.maxPerCustomer')}
          error={fieldError(`${base}.maxPerCustomer`)}
        >
          {(input) => (
            <TextInput
              {...input}
              type="number"
              dir="ltr"
              min={1}
              max={PROMOTION_LIMITS.maxPerCustomer}
              {...register(`${base}.maxPerCustomer`, nullableNumber)}
            />
          )}
        </FormField>
      </div>

      <div className="grid gap-2">
        <h4 className="text-sm font-medium">{t('rules.promotions.tiers')}</h4>
        <Message>{fieldError(`${base}.tiers`)}</Message>
        {fields.map((item, tierIndex) => {
          const tier = `${base}.tiers.${tierIndex}`;
          return (
            <div
              key={item.id}
              role="group"
              aria-label={t('rules.promotions.tier', { n: tierIndex + 1 })}
              className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5"
            >
              <FormField
                label={t('rules.promotions.minQuantity')}
                error={fieldError(`${tier}.minQuantity`)}
              >
                {(input) => (
                  <TextInput
                    {...input}
                    type="number"
                    dir="ltr"
                    min={1}
                    readOnly={single}
                    {...register(`${tier}.minQuantity`, integer)}
                  />
                )}
              </FormField>
              <FormField
                label={t('rules.promotions.gift')}
                error={fieldError(`${tier}.stockItemId`)}
              >
                {(input) => (
                  <Select {...input} {...register(`${tier}.stockItemId`)}>
                    <option value="">{t('admin.choose')}</option>
                    {gifts.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField
                label={t('rules.promotions.giftQuantity')}
                error={fieldError(`${tier}.giftQuantity`)}
              >
                {(input) => (
                  <TextInput
                    {...input}
                    type="number"
                    dir="ltr"
                    min={1}
                    max={PROMOTION_LIMITS.maxGiftQuantity}
                    {...register(`${tier}.giftQuantity`, integer)}
                  />
                )}
              </FormField>
              {!single && (
                <div>
                  <button
                    type="button"
                    className={actionStyle}
                    disabled={fields.length <= PROMOTION_LIMITS.minTiers}
                    onClick={() => remove(tierIndex)}
                  >
                    {t('rules.promotions.removeTier')}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {!single && (
          <div>
            <button
              type="button"
              className={actionStyle}
              disabled={fields.length >= PROMOTION_LIMITS.maxTiers}
              onClick={() =>
                append(emptyTier((getValues(`${base}.tiers`).at(-1)?.minQuantity ?? 0) + 1))
              }
            >
              {t('rules.promotions.addTier')}
            </button>
          </div>
        )}
      </div>
      {!readOnly && (
        <div>
          <button type="button" className={actionStyle} onClick={onRemove}>
            {t('rules.promotions.remove')}
          </button>
        </div>
      )}
    </fieldset>
  );
}

/**
 * Promotions of a draft rule set (FR-090): gift with purchase or tiered gifts, scoped to one campaign
 * product or all of them. The whole list is saved at once.
 */
export function PromotionsEditor({ campaignId, ruleSetId, promotions, products, gifts, readOnly }) {
  const { t } = useTranslation('common');
  const form = useForm({
    resolver: zodResolver(promotionsPayloadSchema),
    defaultValues: { promotions: promotions.map(toForm) },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'promotions' });
  const mutation = useCampaignWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fieldError = (name) =>
    get(form.formState.errors, name) ? t('admin.invalidField') : serverFields[name];
  const ctx = {
    control: form.control,
    register: form.register,
    getValues: form.getValues,
    fieldError,
  };
  const onSubmit = form.handleSubmit((values) =>
    mutation.mutate({
      method: 'put',
      path: `/campaigns/${campaignId}/rule-sets/${ruleSetId}/promotions`,
      body: values,
    }),
  );
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="grid gap-4"
      aria-label={t('rules.promotions.title')}
    >
      <fieldset disabled={readOnly || mutation.isPending} className="grid gap-4">
        {fields.length === 0 && (
          <p className="text-sm text-slate-600">{t('rules.promotions.none')}</p>
        )}
        {fields.map((item, index) => (
          <PromotionCard
            key={item.id}
            index={index}
            ctx={ctx}
            products={products}
            gifts={gifts}
            readOnly={readOnly}
            onRemove={() => remove(index)}
          />
        ))}
        {!readOnly && (
          <div>
            <button type="button" className={actionStyle} onClick={() => append(emptyPromotion())}>
              {t('rules.promotions.add')}
            </button>
          </div>
        )}
      </fieldset>
      <Toast error message={message} />
      {!readOnly && (
        <div>
          <button className={primaryStyle} disabled={mutation.isPending}>
            {t('rules.promotions.save')}
          </button>
        </div>
      )}
    </form>
  );
}
