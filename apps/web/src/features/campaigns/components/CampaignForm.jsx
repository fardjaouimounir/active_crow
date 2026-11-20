import {
  APPROVER_ROLES,
  campaignEditFormSchema,
  campaignFormSchema,
  canEdit,
  today,
} from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { FormField, SearchSelect } from '../../../shared/ui/FormControls.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { InputField, primaryStyle, SelectField } from '../../organization/components/Fields.jsx';
import { useCampaignWrite, useClientOptions } from '../api.js';

const TEXT_FIELDS = [
  ['name', 'text'],
  ['description', 'text'],
  ['startDate', 'date'],
  ['endDate', 'date'],
  ['budgetAmount', 'text'],
];

/** The edit-policy area of each field (the same matrix the API enforces). */
const AREA = {
  name: 'details',
  description: 'details',
  budgetAmount: 'details',
  startDate: 'startDate',
  endDate: 'endDate',
  assignmentApproverRole: 'approver',
};

/** Creates a draft campaign, or edits one at its version when `campaign` is given. */
export function CampaignForm({ campaign, onSuccess, readOnly = false }) {
  const { t } = useTranslation('common');
  const creating = !campaign;
  const {
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(creating ? campaignFormSchema : campaignEditFormSchema),
    defaultValues: {
      ...(creating ? { clientId: '' } : { version: campaign.version }),
      name: campaign?.name ?? '',
      description: campaign?.description ?? '',
      startDate: campaign?.startDate ?? '',
      endDate: campaign?.endDate ?? '',
      budgetAmount: campaign?.budgetAmount ?? '',
      assignmentApproverRole: campaign?.assignmentApproverRole ?? 'regional_manager',
    },
  });
  const values = useWatch({ control });
  const set = (name) => (value) => setValue(name, value, { shouldValidate: true });
  // Fields the campaign's status locks are disabled, with a tooltip saying why.
  const allowed = (name) => creating || (!readOnly && canEdit(campaign, AREA[name]).allowed);
  const fieldProps = (name) => ({
    disabled: !allowed(name),
    title: allowed(name)
      ? undefined
      : t('campaigns.lockedField', { status: t('campaigns.status.' + campaign.status) }),
  });
  const anyEditable = Object.keys(AREA).some(allowed);
  const mutation = useCampaignWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fields = { ...serverFields };
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const onSubmit = handleSubmit(async (body) => {
    try {
      const result = await mutation.mutateAsync({
        method: creating ? 'post' : 'patch',
        path: creating ? '/campaigns' : '/campaigns/' + campaign.id,
        body,
      });
      onSuccess(result);
    } catch {
      // The mutation state exposes the server error to the form.
    }
  });
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      {creating && (
        <FormField label={t('admin.client')} error={fields.clientId}>
          {(props) => (
            <SearchSelect
              {...props}
              required
              useOptions={useClientOptions}
              value={values.clientId}
              onChange={set('clientId')}
            />
          )}
        </FormField>
      )}
      {TEXT_FIELDS.map(([name, type]) => (
        <InputField
          key={name}
          name={name}
          type={type}
          fields={fields}
          value={values[name]}
          {...fieldProps(name)}
          min={
            name === 'endDate' && !creating ? [today(), campaign.endDate].sort().at(-1) : undefined
          }
          required={['name', 'startDate', 'endDate'].includes(name)}
          inputMode={name === 'budgetAmount' ? 'decimal' : undefined}
          placeholder={name === 'budgetAmount' ? t('catalog.priceHint') : undefined}
          dir={name === 'budgetAmount' ? 'ltr' : undefined}
          onChange={set(name)}
        />
      ))}
      <div className="grid gap-1">
        <SelectField
          name="assignmentApproverRole"
          fields={fields}
          {...fieldProps('assignmentApproverRole')}
          value={values.assignmentApproverRole}
          options={APPROVER_ROLES.map((role) => ({ value: role, label: t('roles.' + role) }))}
          onChange={set('assignmentApproverRole')}
        />
        <p className="text-xs text-slate-600">{t('campaigns.approverHelp')}</p>
      </div>
      <Toast error message={message} />
      {anyEditable && (
        <div>
          <button className={primaryStyle} disabled={mutation.isPending}>
            {t('admin.save')}
          </button>
        </div>
      )}
    </form>
  );
}
