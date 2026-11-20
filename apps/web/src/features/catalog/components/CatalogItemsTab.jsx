import { createStockItemSchema, productFormSchema, STOCK_ITEM_KINDS } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FilterBar, useFilters } from '../../../shared/ui/FilterBar.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import {
  actionStyle,
  InputField,
  primaryStyle,
  SelectField,
} from '../../organization/components/Fields.jsx';
import { useCatalogWrite, useClientList } from '../api.js';
import { formatMoney } from '../money.js';

/** The two catalog lists nested under a client. */
export const RESOURCES = {
  products: {
    path: 'products',
    schema: productFormSchema,
    fields: ['sku', 'name', 'unitLabel', 'referencePrice'],
    labels: { create: 'catalog.newProduct', edit: 'catalog.editProduct' },
  },
  stockItems: {
    path: 'stock-items',
    schema: createStockItemSchema,
    fields: ['kind', 'sku', 'name', 'unitLabel'],
    labels: { create: 'catalog.newStockItem', edit: 'catalog.editStockItem' },
  },
};

function ItemForm({ clientId, config, item, onSuccess }) {
  const { t } = useTranslation('common');
  const {
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(config.schema),
    defaultValues: Object.fromEntries(config.fields.map((name) => [name, item?.[name] ?? ''])),
  });
  const values = useWatch({ control });
  const mutation = useCatalogWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fields = { ...serverFields };
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const base = '/clients/' + clientId + '/' + config.path;
  const set = (name) => (value) => setValue(name, value, { shouldValidate: true });
  const onSubmit = handleSubmit(async (body) => {
    try {
      await mutation.mutateAsync({
        method: item ? 'patch' : 'post',
        path: item ? base + '/' + item.id : base,
        body,
      });
      onSuccess();
    } catch {
      // The mutation state exposes the server error to the form.
    }
  });
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      {config.fields.map((name) =>
        name === 'kind' ? (
          <SelectField
            key={name}
            name="kind"
            fields={fields}
            required
            value={values.kind}
            options={STOCK_ITEM_KINDS.map((kind) => ({
              value: kind,
              label: t('catalog.kinds.' + kind),
            }))}
            onChange={set('kind')}
          />
        ) : (
          <InputField
            key={name}
            name={name}
            fields={fields}
            value={values[name]}
            required={name !== 'referencePrice'}
            inputMode={name === 'referencePrice' ? 'decimal' : undefined}
            placeholder={name === 'referencePrice' ? t('catalog.priceHint') : undefined}
            dir={name === 'sku' || name === 'referencePrice' ? 'ltr' : undefined}
            onChange={set(name)}
          />
        ),
      )}
      <Toast error message={message} />
      <div>
        <button className={primaryStyle} disabled={mutation.isPending}>
          {t('admin.save')}
        </button>
      </div>
    </form>
  );
}

function DeleteItem({ clientId, config, item, onClose, onSuccess }) {
  const { t } = useTranslation('common');
  const mutation = useCatalogWrite();
  const { message } = useApiError(mutation.error);
  return (
    <ConfirmDialog
      title={t('admin.delete')}
      message={t('catalog.confirmDelete', { name: item.name })}
      pending={mutation.isPending}
      onClose={onClose}
      onConfirm={() =>
        mutation.mutate(
          { method: 'delete', path: '/clients/' + clientId + '/' + config.path + '/' + item.id },
          { onSuccess },
        )
      }
    >
      <Toast error message={message} />
    </ConfirmDialog>
  );
}

/** Products or gifts & samples of one client: list, create/edit in a modal, confirmed delete. */
export function CatalogItemsTab({ clientId, resource }) {
  const { t, i18n } = useTranslation('common');
  const config = RESOURCES[resource];
  const manage = useCan('catalog.manage');
  const { filters, setFilter } = useFilters();
  const page = Number(filters.page) || 1;
  const params = {
    page,
    sort: filters.sort ?? 'name:asc',
    ...(resource === 'stockItems' && filters.kind ? { kind: filters.kind } : {}),
  };
  const list = useClientList(clientId, config.path, params);
  const { message } = useApiError(list.error);
  const [dialog, setDialog] = useState(null);
  const [saved, setSaved] = useState(false);
  const done = () => {
    setDialog(null);
    setSaved(true);
  };
  const cell = (name) => {
    if (name === 'referencePrice') {
      return ({ getValue }) => <bdi>{formatMoney(getValue(), i18n.resolvedLanguage)}</bdi>;
    }
    if (name === 'kind') return ({ getValue }) => t('catalog.kinds.' + getValue());
    if (name === 'sku') return ({ getValue }) => <bdi dir="ltr">{getValue()}</bdi>;
    return undefined;
  };
  const columns = [
    ...config.fields.map((name) => ({
      accessorKey: name,
      header: t('admin.' + name),
      meta: { sortable: name === 'sku' || name === 'name' },
      ...(cell(name) ? { cell: cell(name) } : {}),
    })),
    ...(manage
      ? [
          {
            id: 'actions',
            header: t('catalog.actions'),
            cell: ({ row }) => (
              <div className="flex flex-wrap gap-2">
                {['edit', 'delete'].map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={actionStyle}
                    aria-label={t('admin.' + mode) + ' ' + row.original.name}
                    onClick={() => {
                      setSaved(false);
                      setDialog({ mode, item: row.original });
                    }}
                  >
                    {t('admin.' + mode)}
                  </button>
                ))}
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <FilterBar>
        {resource === 'stockItems' && (
          <SelectField
            name="kind"
            blank="all"
            value={filters.kind}
            options={STOCK_ITEM_KINDS.map((kind) => ({
              value: kind,
              label: t('catalog.kinds.' + kind),
            }))}
            onChange={(value) => setFilter('kind', value)}
          />
        )}
        {manage && (
          <button
            type="button"
            className={primaryStyle}
            onClick={() => {
              setSaved(false);
              setDialog({ mode: 'create' });
            }}
          >
            {t(config.labels.create)}
          </button>
        )}
      </FilterBar>
      {saved && <Toast message={t('admin.saved')} />}
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        {...list.data?.meta}
        page={page}
        sort={params.sort}
        loading={list.isPending}
        error={message}
        onSort={(value) => setFilter('sort', value)}
        onPage={(value) => setFilter('page', value)}
      />
      {(dialog?.mode === 'create' || dialog?.mode === 'edit') && (
        <Modal
          title={t(dialog.mode === 'create' ? config.labels.create : config.labels.edit)}
          onClose={() => setDialog(null)}
        >
          <ItemForm clientId={clientId} config={config} item={dialog.item} onSuccess={done} />
        </Modal>
      )}
      {dialog?.mode === 'delete' && (
        <DeleteItem
          clientId={clientId}
          config={config}
          item={dialog.item}
          onClose={() => setDialog(null)}
          onSuccess={done}
        />
      )}
    </>
  );
}
