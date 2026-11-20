import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { primaryStyle } from '../../organization/components/Fields.jsx';
import { useCampaignWrite, useClientProducts } from '../api.js';

/** FR-031: the client's products promoted by the campaign. */
export function ProductsTab({ campaign, canEdit, canRemove = canEdit }) {
  const { t } = useTranslation('common');
  const products = useClientProducts(campaign.client.id);
  const [selected, setSelected] = useState(null);
  const linked = selected ?? campaign.products.map(({ id }) => id);
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error ?? products.error);
  if (products.pending) return <p role="status">{t('admin.loading')}</p>;
  const toggle = (id) =>
    setSelected(linked.includes(id) ? linked.filter((item) => item !== id) : [...linked, id]);
  return (
    <div className="grid gap-4">
      <Toast error message={message} />
      {!products.rows.length && <EmptyState />}
      <ul className="grid gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        {products.rows.map((product) => (
          <li key={product.id}>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                disabled={
                  !canEdit ||
                  (!canRemove && campaign.products.some((item) => item.id === product.id))
                }
                title={
                  !canRemove && campaign.products.some((item) => item.id === product.id)
                    ? t('campaigns.productsLocked')
                    : undefined
                }
                checked={linked.includes(product.id)}
                onChange={() => toggle(product.id)}
              />
              {product.name} <bdi className="text-slate-500">{product.sku}</bdi>
            </label>
          </li>
        ))}
      </ul>
      {canEdit && selected && (
        <div>
          <button
            type="button"
            className={primaryStyle}
            disabled={mutation.isPending}
            onClick={() =>
              mutation.mutate(
                {
                  method: 'put',
                  path: '/campaigns/' + campaign.id + '/products',
                  body: { productIds: linked },
                },
                { onSuccess: () => setSelected(null) },
              )
            }
          >
            {t('admin.save')}
          </button>
        </div>
      )}
    </div>
  );
}
