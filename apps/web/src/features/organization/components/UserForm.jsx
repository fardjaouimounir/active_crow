import { createUserFormSchema, updateUserFormSchema } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, SearchSelect } from '../../../shared/ui/FormControls.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useManagers, useOrganizationWrite } from '../api.js';
import { InputField, LocationFields, primaryStyle, SelectField } from './Fields.jsx';

export const managerRoles = {
  animateur: ['supervisor'],
  supervisor: ['regional_manager'],
  regional_manager: ['general_manager', 'director'],
  general_manager: ['director'],
};

export function ManagerField({ roles, value, onChange, error, required }) {
  const { t } = useTranslation('common');
  const useOptions = (q) => useManagers(q, roles);
  return (
    <FormField label={t('admin.manager')} error={error}>
      {(props) => (
        <SearchSelect
          {...props}
          useOptions={useOptions}
          value={value}
          onChange={onChange}
          required={required}
        />
      )}
    </FormField>
  );
}

const textFields = ['fullName', 'email', 'phone'];
const profileFields = ['experienceYears', 'skills', 'languages', 'notes'];

export function UserForm({ user, profile, onSuccess }) {
  const { t } = useTranslation('common');
  const creating = !user;
  const {
    control,
    setValue,
    handleSubmit,
    unregister,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(creating ? createUserFormSchema : updateUserFormSchema),
    defaultValues: {
      fullName: user?.fullName ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? null,
      wilayaId: user?.wilayaId ?? null,
      communeId: user?.communeId ?? null,
      ...(creating ? { role: '' } : {}),
      ...(profile
        ? {
            profile: {
              ...profile,
              skills: profile.skills?.join(', '),
              languages: profile.languages?.join(', '),
            },
          }
        : {}),
    },
  });
  const values = useWatch({ control });
  const role = user?.role ?? values.role;
  const set = (patch) => {
    for (const [key, value] of Object.entries(patch))
      setValue(key, value, { shouldValidate: true });
  };
  const mutation = useOrganizationWrite();
  const { fields: serverFields, message } = useApiError(mutation.error);
  const fields = { ...serverFields };
  for (const key of [...textFields, 'role', 'managerId', 'wilayaId', 'communeId']) {
    if (errors[key]) fields[key] = t('admin.invalidField');
  }
  const onSubmit = handleSubmit(async (body) => {
    try {
      const result = await mutation.mutateAsync({
        method: creating ? 'post' : 'patch',
        path: creating ? '/users' : '/users/' + user.id,
        body,
      });
      mutation.reset();
      onSuccess(result);
    } catch {
      // The mutation state exposes the server error to the form.
    }
  });
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      {creating && (
        <SelectField
          name="role"
          fields={fields}
          required
          value={role}
          options={Object.keys(managerRoles).map((value) => ({
            value,
            label: t('roles.' + value),
          }))}
          onChange={(value) => {
            unregister(['managerId', 'profile']);
            set({ role: value });
          }}
        />
      )}
      {creating && role && (
        <ManagerField
          key={role}
          roles={managerRoles[role]}
          value={values.managerId}
          onChange={(value) => (value ? set({ managerId: value }) : unregister('managerId'))}
          error={fields.managerId}
          required={role !== 'general_manager'}
        />
      )}
      {textFields.map((name) => (
        <InputField
          key={name}
          name={name}
          fields={fields}
          value={values[name]}
          onChange={(value) => set({ [name]: name === 'phone' ? value || null : value })}
          type={name === 'email' ? 'email' : name === 'phone' ? 'tel' : 'text'}
          required={name !== 'phone'}
        />
      ))}
      <LocationFields values={values} set={set} fields={fields} />
      {role === 'animateur' &&
        profileFields.map((name) => (
          <InputField
            key={name}
            name={name}
            fields={{
              [name]: errors.profile?.[name] ? t('admin.invalidField') : fields['profile.' + name],
            }}
            value={values.profile?.[name]}
            onChange={(value) =>
              setValue(
                'profile.' + name,
                name === 'experienceYears'
                  ? value === ''
                    ? null
                    : Number(value)
                  : name === 'notes'
                    ? value || null
                    : value,
                { shouldValidate: true },
              )
            }
            type={name === 'experienceYears' ? 'number' : 'text'}
            min={name === 'experienceYears' ? 0 : undefined}
            max={name === 'experienceYears' ? 100 : undefined}
            placeholder={
              name === 'skills' || name === 'languages' ? t('admin.listFormat') : undefined
            }
          />
        ))}
      <Toast error message={message} />
      <div>
        <button className={primaryStyle} disabled={mutation.isPending || !role}>
          {t('admin.save')}
        </button>
      </div>
    </form>
  );
}
