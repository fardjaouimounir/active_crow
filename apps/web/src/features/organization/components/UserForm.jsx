import { useState } from 'react';
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
const list = (value) =>
  String(value ?? '')
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter(Boolean);

export function UserForm({ user, profile, onSuccess }) {
  const { t } = useTranslation('common');
  const [values, setValues] = useState(() => ({
    ...user,
    ...profile,
    skills: profile?.skills?.join(', '),
    languages: profile?.languages?.join(', '),
  }));
  const set = (values) => setValues((previous) => ({ ...previous, ...values }));
  const mutation = useOrganizationWrite();
  const { fields, message } = useApiError(mutation.error);
  const role = user?.role ?? values.role;
  const creating = !user;
  const change = (key) => (value) => set({ [key]: value });
  const onSubmit = async (event) => {
    event.preventDefault();
    const body = {
      fullName: values.fullName,
      email: values.email,
      phone: values.phone || null,
      wilayaId: Number(values.wilayaId) || null,
      communeId: Number(values.communeId) || null,
    };
    if (creating) {
      body.role = role;
      if (values.managerId) body.managerId = values.managerId;
    }
    if (role === 'animateur') {
      body.profile = {
        experienceYears:
          values.experienceYears === '' || values.experienceYears == null
            ? null
            : Number(values.experienceYears),
        skills: list(values.skills),
        languages: list(values.languages),
        notes: values.notes || null,
      };
    }
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
  };
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
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
          onChange={(value) => set({ role: value, managerId: '' })}
        />
      )}
      {creating && role && (
        <ManagerField
          key={role}
          roles={managerRoles[role]}
          value={values.managerId}
          onChange={change('managerId')}
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
          onChange={change(name)}
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
            fields={{ [name]: fields['profile.' + name] }}
            value={values[name]}
            onChange={change(name)}
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
