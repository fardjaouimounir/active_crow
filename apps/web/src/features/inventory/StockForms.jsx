import {
  adjustmentBody,
  adjustmentRejectionBody,
  adjustmentApprovalBody,
  confirmBody,
  resolveBody,
  returnBody,
  stockInBody,
  transferBody,
} from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../shared/auth/hooks.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { FileDropzone } from '../../shared/ui/FileDropzone.jsx';
import { FormField, Select, TextInput } from '../../shared/ui/FormControls.jsx';
import { Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useClientStockItems } from '../campaigns/api.js';
import { primaryStyle, actionStyle } from '../organization/components/Fields.jsx';
import { useBalances, useIdempotencyKey, useRecipients, useStockWrite } from './api.js';

/** Items of the sender's own location (warehouse for director / general manager) with quantities. */
export function useSenderStock(campaignId) {
  const { user } = useAuth();
  const query = useBalances(campaignId);
  const wide = ['director', 'general_manager'].includes(user?.role);
  const data = query.data?.data;
  const row = data?.locations.find((entry) =>
    wide ? entry.kind === 'warehouse' : entry.userId === user?.id,
  );
  const items = (data?.items ?? [])
    .map((item) => ({
      value: item.id,
      label: item.name + ' (' + item.sku + ')',
      available: row?.quantities[item.id] ?? 0,
    }))
    .filter((item) => item.available > 0);
  return { items, pending: query.isPending };
}

/** Editable lines: item select + quantity, showing the available quantity next to it. */
export function LinesField({
  form,
  items,
  name = 'lines',
  quantityKey = 'quantity',
  fixed = false,
}) {
  const { t } = useTranslation('common');
  const { fields, append, remove } = useFieldArray({ control: form.control, name });
  const lines = useWatch({ control: form.control, name }) ?? [];
  const errors = form.formState.errors[name];
  return (
    <fieldset className="grid gap-2">
      {fields.map((field, index) => {
        const available = items.find((item) => item.value === lines[index]?.stockItemId)?.available;
        return (
          <div key={field.id} className="flex flex-wrap items-end gap-2">
            <FormField
              label={t('stock.item')}
              error={errors?.[index]?.stockItemId && t('admin.invalidField')}
            >
              {(props) => (
                <Select
                  {...props}
                  disabled={fixed}
                  {...form.register(`${name}.${index}.stockItemId`)}
                >
                  <option value="">{t('admin.choose')}</option>
                  {items.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              label={t('stock.quantity')}
              error={errors?.[index]?.[quantityKey] && t('admin.invalidField')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  type="number"
                  min={quantityKey === 'quantity' ? 1 : 0}
                  {...form.register(`${name}.${index}.${quantityKey}`, { valueAsNumber: true })}
                />
              )}
            </FormField>
            {available !== undefined && (
              <span className="pb-2 text-sm text-slate-600">
                {t('stock.available', { count: available })}
              </span>
            )}
            {!fixed && fields.length > 1 && (
              <button type="button" className={actionStyle} onClick={() => remove(index)}>
                {t('stock.removeLine')}
              </button>
            )}
          </div>
        );
      })}
      {errors?.message && (
        <p role="alert" className="text-sm text-red-700">
          {t('admin.invalidField')}
        </p>
      )}
      {!fixed && (
        <div>
          <button
            type="button"
            className={actionStyle}
            onClick={() => append({ stockItemId: '', [quantityKey]: 1 })}
          >
            {t('stock.addLine')}
          </button>
        </div>
      )}
    </fieldset>
  );
}

const clean = (values) =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => value !== '' && value != null));

/**
 * Shared shell of every stock form: React Hook Form with a shared Zod schema, one Idempotency-Key
 * per opened dialog, the API error and a submit button.
 */
export function StockFormDialog({
  title,
  schema,
  defaultValues,
  request,
  onClose,
  withFile,
  children,
}) {
  const { t } = useTranslation('common');
  const idempotency = useIdempotencyKey();
  const mutation = useStockWrite(idempotency);
  const { message } = useApiError(mutation.error);
  const [file, setFile] = useState(null);
  // Blank optional inputs are dropped before validation, as they are before sending.
  const form = useForm({
    resolver: (values, context, options) => zodResolver(schema)(clean(values), context, options),
    defaultValues,
  });
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={form.handleSubmit((values) =>
          mutation.mutate(
            { ...request(clean(values)), file: withFile ? file : undefined },
            { onSuccess: onClose },
          ),
        )}
      >
        {children({ form, file, setFile, mutation })}
        <Toast error message={message} />
        <div>
          <button className={primaryStyle} disabled={mutation.isPending}>
            {t('stock.actions.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TextArea({ form, name, label, required }) {
  const { t } = useTranslation('common');
  return (
    <FormField
      label={t(label) + (required ? ' *' : '')}
      error={form.formState.errors[name] && t('admin.invalidField')}
    >
      {(props) => <TextInput {...props} {...form.register(name)} />}
    </FormField>
  );
}

export function StockInDialog({ campaign, onClose }) {
  const { t } = useTranslation('common');
  const { options } = useClientStockItems(campaign.client.id);
  const items = options.map(({ value, label }) => ({ value, label }));
  return (
    <StockFormDialog
      title={t('stock.actions.stockIn')}
      schema={stockInBody}
      withFile
      defaultValues={{ reference: '', note: '', lines: [{ stockItemId: '', quantity: 1 }] }}
      request={(body) => ({ path: `/campaigns/${campaign.id}/stock/stock-in`, body })}
      onClose={onClose}
    >
      {({ form, file, setFile }) => (
        <>
          <TextArea form={form} name="reference" label="stock.reference" required />
          <LinesField form={form} items={items} />
          <TextArea form={form} name="note" label="stock.note" />
          <FileDropzone kind="stock_document" file={file} onFile={setFile} />
        </>
      )}
    </StockFormDialog>
  );
}

export function TransferDialog({ campaign, onClose }) {
  const { t } = useTranslation('common');
  const stock = useSenderStock(campaign.id);
  const recipients = useRecipients(campaign.id, 'down');
  const people = (recipients.data?.data ?? []).filter((entry) => entry.kind === 'user');
  return (
    <StockFormDialog
      title={t('stock.actions.transfer')}
      schema={transferBody}
      defaultValues={{ recipientUserId: '', note: '', lines: [{ stockItemId: '', quantity: 1 }] }}
      request={(body) => ({ path: `/campaigns/${campaign.id}/stock/transfers`, body })}
      onClose={onClose}
    >
      {({ form }) => (
        <>
          <FormField
            label={t('stock.recipient')}
            error={form.formState.errors.recipientUserId && t('admin.invalidField')}
          >
            {(props) => (
              <Select {...props} {...form.register('recipientUserId')}>
                <option value="">{t('admin.choose')}</option>
                {people.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {recipients.isSuccess && !people.length && (
            <p className="text-sm">{t('stock.noRecipients')}</p>
          )}
          <LinesField form={form} items={stock.items} />
          <TextArea form={form} name="note" label="stock.note" />
        </>
      )}
    </StockFormDialog>
  );
}

/** Return up the chain, or back to the client (director). */
export function ReturnDialog({ campaign, onClose }) {
  const { t } = useTranslation('common');
  const stock = useSenderStock(campaign.id);
  const recipients = useRecipients(campaign.id, 'up');
  const entries = recipients.data?.data ?? [];
  const people = entries.filter((entry) => entry.kind === 'user');
  const destinations = [...new Set(entries.map((entry) => entry.kind))];
  return (
    <StockFormDialog
      title={t('stock.actions.return')}
      schema={returnBody}
      defaultValues={{
        destination: '',
        recipientUserId: '',
        reference: '',
        note: '',
        lines: [{ stockItemId: '', quantity: 1 }],
      }}
      request={(body) => ({ path: `/campaigns/${campaign.id}/stock/returns`, body })}
      onClose={onClose}
    >
      {({ form }) => {
        const destination = form.watch('destination');
        return (
          <>
            <FormField
              label={t('stock.destination')}
              error={form.formState.errors.destination && t('admin.invalidField')}
            >
              {(props) => (
                <Select {...props} {...form.register('destination')}>
                  <option value="">{t('admin.choose')}</option>
                  {destinations.map((kind) => (
                    <option key={kind} value={kind}>
                      {t('stock.destinations.' + kind)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {destination === 'user' && (
              <FormField
                label={t('stock.recipient')}
                error={form.formState.errors.recipientUserId && t('admin.invalidField')}
              >
                {(props) => (
                  <Select {...props} {...form.register('recipientUserId')}>
                    <option value="">{t('admin.choose')}</option>
                    {people.map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.fullName}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
            {destination === 'client' && (
              <TextArea form={form} name="reference" label="stock.reference" required />
            )}
            <LinesField form={form} items={stock.items} />
            <TextArea form={form} name="note" label="stock.note" />
          </>
        );
      }}
    </StockFormDialog>
  );
}

/** The recipient states what arrived; defaults to the sent quantities. */
export function ConfirmTransferDialog({ movement, onClose }) {
  const { t } = useTranslation('common');
  const items = movement.lines.map((line) => ({
    value: line.stockItemId,
    label: line.name + ' (' + line.sku + ')',
    available: line.quantity,
  }));
  return (
    <StockFormDialog
      title={t('stock.mine.confirmTitle')}
      schema={confirmBody}
      defaultValues={{
        lines: movement.lines.map((line) => ({
          stockItemId: line.stockItemId,
          quantityReceived: line.quantity,
        })),
      }}
      request={(body) => ({ path: `/stock/transfers/${movement.id}/confirm`, body })}
      onClose={onClose}
    >
      {({ form }) => <LinesField form={form} items={items} quantityKey="quantityReceived" fixed />}
    </StockFormDialog>
  );
}

export function AdjustmentDialog({ campaign, onClose }) {
  const { t } = useTranslation('common');
  const stock = useSenderStock(campaign.id);
  return (
    <StockFormDialog
      title={t('stock.actions.adjust')}
      schema={adjustmentBody}
      withFile
      defaultValues={{ reason: 'damaged', note: '', lines: [{ stockItemId: '', quantity: 1 }] }}
      request={(body) => ({ path: `/campaigns/${campaign.id}/stock/adjustments`, body })}
      onClose={onClose}
    >
      {({ form, file, setFile }) => (
        <>
          <p className="text-sm text-slate-600">{t('stock.increaseNote')}</p>
          <FormField label={t('stock.reason')}>
            {(props) => (
              <Select {...props} {...form.register('reason')}>
                {['damaged', 'lost', 'stolen', 'count_correction'].map((reason) => (
                  <option key={reason} value={reason}>
                    {t('stock.reasons.' + reason)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <LinesField form={form} items={stock.items} />
          <TextArea form={form} name="note" label="stock.note" required />
          <FileDropzone kind="stock_adjustment_proof" file={file} onFile={setFile} />
        </>
      )}
    </StockFormDialog>
  );
}

export function ResolveDialog({ movement, onClose }) {
  const { t } = useTranslation('common');
  const short = movement.lines.filter((line) => line.quantity > (line.quantityReceived ?? 0));
  return (
    <StockFormDialog
      title={t('stock.actions.resolve')}
      schema={resolveBody}
      defaultValues={{
        note: '',
        lines: short.map((line) => ({
          stockItemId: line.stockItemId,
          decision: 'return_to_sender',
        })),
      }}
      request={(body) => ({ path: `/stock/transfers/${movement.id}/resolve`, body })}
      onClose={onClose}
    >
      {({ form }) => (
        <>
          {short.map((line, index) => (
            <FormField
              key={line.stockItemId}
              label={`${line.name} — ${line.quantity - (line.quantityReceived ?? 0)}`}
            >
              {(props) => (
                <Select {...props} {...form.register(`lines.${index}.decision`)}>
                  {['return_to_sender', 'loss'].map((value) => (
                    <option key={value} value={value}>
                      {t('stock.decisions.' + value)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ))}
          <TextArea form={form} name="note" label="stock.reason" />
        </>
      )}
    </StockFormDialog>
  );
}

export function DecideDialog({ movement, decision, onClose }) {
  const { t } = useTranslation('common');
  return (
    <StockFormDialog
      title={t('stock.actions.' + decision)}
      schema={decision === 'reject' ? adjustmentRejectionBody : adjustmentApprovalBody}
      defaultValues={{ note: '' }}
      request={(body) => ({ path: `/stock/adjustments/${movement.id}/${decision}`, body })}
      onClose={onClose}
    >
      {({ form }) => (
        <TextArea form={form} name="note" label="stock.note" required={decision === 'reject'} />
      )}
    </StockFormDialog>
  );
}
