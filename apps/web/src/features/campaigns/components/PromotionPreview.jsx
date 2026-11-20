import { evaluatePromotions } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput } from '../../../shared/ui/FormControls.jsx';

/**
 * "What gifts would this sale earn?" — the saved promotions evaluated with the very function the
 * server uses (`evaluatePromotions` from @fieldflow/shared), for quantities typed per product.
 * @param {{ promotions: Array<object>, products: Array<{ id: string, name: string }>, gifts: Array<{ value: string, label: string }> }} props
 */
export function PromotionPreview({ promotions, products, gifts }) {
  const { t, i18n } = useTranslation('common');
  const [quantities, setQuantities] = useState({});
  const saleItems = products
    .map((product) => ({ productId: product.id, quantity: Number(quantities[product.id]) }))
    .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
  const entitlements = evaluatePromotions(promotions, saleItems);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const giftName = (id) => gifts.find((gift) => gift.value === id)?.label ?? id;
  const promotionName = (id) => promotions.find((promotion) => promotion.id === id)?.name ?? id;

  return (
    <section
      aria-label={t('rules.preview.title')}
      className="grid gap-3 rounded-xl border border-line bg-surface p-4"
    >
      <h3 className="font-semibold">{t('rules.preview.title')}</h3>
      <p className="text-sm text-fg-2">{t('rules.preview.hint')}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <label key={product.id} className="grid gap-1 text-sm">
            <span className="font-medium">{product.name}</span>
            <TextInput
              type="number"
              dir="ltr"
              min={0}
              value={quantities[product.id] ?? ''}
              onChange={(event) =>
                setQuantities({ ...quantities, [product.id]: event.target.value })
              }
            />
          </label>
        ))}
      </div>
      <div role="status" aria-live="polite">
        <h4 className="text-sm font-medium">{t('rules.preview.result')}</h4>
        {entitlements.length === 0 ? (
          <p className="text-sm text-fg-2">{t('rules.preview.none')}</p>
        ) : (
          <ul className="list-disc ps-5 text-sm">
            {entitlements.map((entitlement) => (
              <li key={entitlement.promotionId}>
                {t('rules.preview.line', {
                  quantity: number.format(entitlement.quantity),
                  gift: giftName(entitlement.stockItemId),
                  promotion: promotionName(entitlement.promotionId),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
