import { issueCategories, issueCreate } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { FormField } from '../../shared/ui/FormControls.jsx';
import { Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useCampaign, useCampaigns, useClientStockItems } from '../campaigns/api.js';
import { useCommunicationWrite } from '../notifications/api.js';
import { InputField, SelectField, primaryStyle } from '../organization/components/Fields.jsx';

export function formBody(data, files) {
  if (!files.length) return data;
  const body = new FormData();
  for (const [name, value] of Object.entries(data))
    if (value !== undefined) body.append(name, value);
  files.forEach((file) => body.append('files', file));
  return body;
}

export function AttachmentsInput({ onChange }) {
  const { t } = useTranslation('common');
  return (
    <FormField label={t('issues.attachments')}>
      {(props) => (
        <input
          {...props}
          type="file"
          multiple
          onChange={(event) => onChange(Array.from(event.target.files))}
        />
      )}
    </FormField>
  );
}

export function IssueForm({ campaignId, onClose, onCreated }) {
  const { t } = useTranslation('common');
  const [files, setFiles] = useState([]);
  const campaigns = useCampaigns({ pageSize: 100 });
  const mutation = useCommunicationWrite();
  const form = useForm({
    resolver: zodResolver(issueCreate),
    defaultValues: { campaignId: campaignId ?? '', category: 'other', title: '', description: '' },
  });
  const values = useWatch({ control: form.control });
  const selected = useCampaign(values.campaignId);
  const campaign = selected.data?.data;
  const gifts = useClientStockItems(campaign?.clientId ?? campaign?.client?.id, 'gift');
  const samples = useClientStockItems(campaign?.clientId ?? campaign?.client?.id, 'sample');
  const { message, fields } = useApiError(mutation.error);
  const errors = {
    ...fields,
    ...Object.fromEntries(
      Object.keys(form.formState.errors).map((key) => [key, t('admin.invalidField')]),
    ),
  };
  const set = (name) => (value) =>
    value || !['pointOfSaleId', 'stockItemId'].includes(name)
      ? form.setValue(name, value)
      : form.unregister(name);
  return (
    <Modal title={t('issues.new')} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={form.handleSubmit((data) =>
          mutation.mutate(
            { path: '/issues', body: formBody(data, files) },
            { onSuccess: ({ data }) => onCreated(data) },
          ),
        )}
      >
        {!campaignId && (
          <SelectField
            name="campaign"
            fields={{ campaign: errors.campaignId }}
            value={values.campaignId}
            options={(campaigns.data?.data ?? [])
              .filter(({ status }) => ['assigned', 'active', 'suspended'].includes(status))
              .map(({ id, name }) => ({ value: id, label: name }))}
            onChange={(value) => {
              set('campaignId')(value);
              form.unregister(['pointOfSaleId', 'stockItemId']);
            }}
          />
        )}
        <SelectField
          name="point"
          fields={{ point: errors.pointOfSaleId }}
          value={values.pointOfSaleId}
          options={(campaign?.pointsOfSale ?? []).map(({ id, name }) => ({
            value: id,
            label: name,
          }))}
          onChange={set('pointOfSaleId')}
        />
        <SelectField
          name="stockItem"
          fields={{ stockItem: errors.stockItemId }}
          value={values.stockItemId}
          options={[...gifts.options, ...samples.options]}
          onChange={set('stockItemId')}
        />
        <SelectField
          name="category"
          fields={errors}
          value={values.category}
          options={issueCategories.map((value) => ({
            value,
            label: t('issues.categories.' + value),
          }))}
          onChange={set('category')}
        />
        <InputField name="title" fields={errors} value={values.title} onChange={set('title')} />
        <FormField label={t('admin.description')} error={errors.description}>
          {(props) => (
            <textarea
              {...props}
              {...form.register('description')}
              rows={4}
              className="rounded border p-2"
            />
          )}
        </FormField>
        <AttachmentsInput onChange={setFiles} />
        <Toast
          error
          message={files.length > 3 ? t('errors.codes.TOO_MANY_ATTACHMENTS') : message}
        />
        <div>
          <button className={primaryStyle} disabled={files.length > 3 || mutation.isPending}>
            {t('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
