import { useTranslation } from 'react-i18next';
import { FormField, Select, TextInput } from '../../../shared/ui/FormControls.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useCommunes, useWilayas } from '../api.js';

export const actionStyle =
  'inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-50';
export const primaryStyle =
  'inline-flex items-center rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';

export function InputField({ name, label = name, fields, value, onChange, ...props }) {
  const { t } = useTranslation('common');
  return (
    <FormField label={t('admin.' + label)} error={fields?.[name]}>
      {(input) => (
        <TextInput
          {...input}
          {...props}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

export function SelectField({
  name,
  fields,
  value,
  onChange,
  options,
  blank = 'choose',
  ...props
}) {
  const { t } = useTranslation('common');
  return (
    <FormField label={t('admin.' + name)} error={fields?.[name]}>
      {(input) => (
        <Select
          {...input}
          {...props}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t('admin.' + blank)}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
    </FormField>
  );
}

export function areaOptions(areas, language) {
  return (areas ?? []).map((area) => ({
    value: area.id,
    label: language === 'ar' ? area.nameAr : area.nameEn,
  }));
}

export function LocationFields({ values, set, fields, required }) {
  const { i18n, t } = useTranslation('common');
  const wilayas = useWilayas();
  const communes = useCommunes(values.wilayaId);
  return (
    <>
      <SelectField
        name="wilaya"
        required={required}
        fields={{ wilaya: fields.wilayaId }}
        value={values.wilayaId}
        disabled={wilayas.isLoading}
        options={areaOptions(wilayas.data?.data, i18n.resolvedLanguage)}
        onChange={(value) => set({ wilayaId: value, communeId: '' })}
      />
      <SelectField
        name="commune"
        fields={{ commune: fields.communeId }}
        value={values.communeId}
        disabled={!values.wilayaId || communes.isLoading}
        options={areaOptions(communes.data?.data, i18n.resolvedLanguage)}
        onChange={(value) => set({ communeId: value })}
      />
      {(wilayas.isError || communes.isError) && (
        <Toast error message={t('errors.codes.NETWORK_ERROR')} />
      )}
    </>
  );
}
