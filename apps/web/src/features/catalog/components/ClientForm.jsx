import { clientFormSchema } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { InputField, primaryStyle } from '../../organization/components/Fields.jsx';
import { useCatalogWrite } from '../api.js';

const FIELDS = [
  ['name', 'text'],
  ['legalName', 'text'],
  ['contactName', 'text'],
  ['contactEmail', 'email'],
  ['contactPhone', 'tel'],
];

/** Creates a client, or edits one when `client` is given (last write wins on the server). */
export function ClientForm({ client, onSuccess, disabled = false }) {
  const { t } = useTranslation('common');
  const {
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(clientFormSchema),
    defaultValues: Object.fromEntries(FIELDS.map(([name]) => [name, client?.[name] ?? ''])),
  });
  const values = useWatch({ control });
  const mutation = useCatalogWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fields = { ...serverFields };
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const onSubmit = handleSubmit(async (body) => {
    try {
      const result = await mutation.mutateAsync({
        method: client ? 'patch' : 'post',
        path: client ? '/clients/' + client.id : '/clients',
        body,
      });
      onSuccess(result);
    } catch {
      // The mutation state exposes the server error to the form.
    }
  });
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      {FIELDS.map(([name, type]) => (
        <InputField
          key={name}
          name={name}
          type={type}
          fields={fields}
          value={values[name]}
          disabled={disabled}
          required={name === 'name'}
          onChange={(value) => setValue(name, value, { shouldValidate: true })}
        />
      ))}
      <Toast error message={message} />
      {!disabled && (
        <div>
          <button className={primaryStyle} disabled={mutation.isPending}>
            {t('admin.save')}
          </button>
        </div>
      )}
    </form>
  );
}
