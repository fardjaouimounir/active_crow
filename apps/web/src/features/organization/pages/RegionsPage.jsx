import { createRegionSchema, updateRegionSchema, regionWilayasSchema } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FilterBar, useFilters } from '../../../shared/ui/FilterBar.jsx';
import { FormField, Select } from '../../../shared/ui/FormControls.jsx';
import { EmptyState, PageHeader, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useOrganizationResource, useOrganizationWrite, useWilayas } from '../api.js';
import { InputField, actionStyle, areaOptions, primaryStyle } from '../components/Fields.jsx';

function RegionEditor({ dialog, regions, onClose, onSuccess }) {
  const { t, i18n } = useTranslation('common');
  const { mode, region } = dialog;
  const assigning = mode === 'regionWilayas';
  const {
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(
      assigning ? regionWilayasSchema : region ? updateRegionSchema : createRegionSchema,
    ),
    defaultValues: assigning
      ? { wilayaIds: region.wilayas.map(({ wilaya }) => wilaya.id) }
      : { name: region?.name ?? '', code: region?.code ?? '' },
  });
  const { name, code, wilayaIds } = useWatch({ control });
  const set = (key) => (value) => setValue(key, value, { shouldValidate: true });
  const areas = useWilayas();
  const mutation = useOrganizationWrite();
  const { message, fields: serverFields } = useApiError(
    mutation.error ?? (mode === 'regionWilayas' && areas.error),
  );
  const fields = { ...serverFields };
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const path = region ? '/regions/' + region.id : '/regions';
  const disabled = mutation.isPending;
  if (mode === 'delete')
    return (
      <ConfirmDialog
        title={t('admin.delete')}
        message={t('admin.confirmChange')}
        pending={disabled}
        onClose={onClose}
        onConfirm={() => mutation.mutate({ method: 'delete', path }, { onSuccess })}
      >
        <Toast error message={message} />
      </ConfirmDialog>
    );
  const assigned = new Set(
    regions
      .filter((item) => item.id !== region?.id)
      .flatMap((item) => item.wilayas.map(({ wilaya }) => wilaya.id)),
  );
  const available = areaOptions(
    areas.data?.data?.filter((area) => !assigned.has(area.id)),
    i18n.resolvedLanguage,
  );
  return (
    <Modal title={t('admin.' + mode)} onClose={onClose}>
      <form
        className="grid gap-4"
        noValidate
        onSubmit={handleSubmit((body) => {
          mutation.mutate(
            mode === 'regionWilayas'
              ? { method: 'put', path: path + '/wilayas', body }
              : { method: region ? 'patch' : 'post', path, body },
            { onSuccess },
          );
        })}
      >
        {mode === 'regionWilayas' ? (
          <FormField label={t('admin.wilaya')} error={fields.wilayaIds}>
            {(props) => (
              <Select
                {...props}
                multiple
                size={10}
                value={wilayaIds.map(String)}
                disabled={areas.isPending}
                onChange={(event) =>
                  set('wilayaIds')(
                    Array.from(event.target.selectedOptions, (option) => Number(option.value)),
                  )
                }
              >
                {available.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        ) : (
          <>
            <InputField name="name" value={name} onChange={set('name')} fields={fields} required />
            <InputField name="code" value={code} onChange={set('code')} fields={fields} required />
          </>
        )}
        <Toast error message={message} />
        <div>
          <button className={primaryStyle} disabled={disabled}>
            {t('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function RegionsPage() {
  const { t, i18n } = useTranslation('common');
  const manage = useCan('org.structure.manage');
  const query = useOrganizationResource('/regions');
  const { message } = useApiError(query.error);
  const [dialog, setDialog] = useState(null);
  const [saved, setSaved] = useState(false);
  const { filters, setFilter } = useFilters();
  const regions = query.data?.data ?? [];
  const visible = regions.filter((item) =>
    (item.name + ' ' + item.code).toLowerCase().includes((filters.q ?? '').toLowerCase()),
  );
  return (
    <>
      <PageHeader title={t('admin.regions')}>
        {manage && (
          <button
            type="button"
            className={primaryStyle}
            onClick={() => setDialog({ mode: 'newRegion' })}
          >
            {t('admin.newRegion')}
          </button>
        )}
      </PageHeader>
      <FilterBar>
        <InputField
          name="search"
          type="search"
          value={filters.q}
          onChange={(value) => setFilter('q', value)}
        />
      </FilterBar>
      {saved && <Toast message={t('admin.saved')} />}
      {query.isPending && <p role="status">{t('admin.loading')}</p>}
      {message && <Toast error message={message} />}
      {query.isSuccess && !visible.length && <EmptyState />}
      <ul className="grid gap-3">
        {visible.map((region) => (
          <li key={region.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">{region.name}</h2>
                <bdi className="text-xs text-slate-500">{region.code}</bdi>
              </div>
              {manage && (
                <div className="flex flex-wrap gap-2">
                  {['edit', 'regionWilayas', 'delete'].map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={actionStyle}
                      onClick={() => setDialog({ mode, region })}
                    >
                      {t('admin.' + mode)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {region.wilayas.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {areaOptions(
                  region.wilayas.map(({ wilaya }) => wilaya),
                  i18n.resolvedLanguage,
                ).map(({ value, label }) => (
                  <li key={value} className="rounded-full bg-slate-100 px-3 py-1 text-xs">
                    {label}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {dialog && (
        <RegionEditor
          dialog={dialog}
          regions={regions}
          onClose={() => setDialog(null)}
          onSuccess={() => {
            setDialog(null);
            setSaved(true);
          }}
        />
      )}
    </>
  );
}
