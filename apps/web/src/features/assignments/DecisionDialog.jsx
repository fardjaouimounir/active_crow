import { assignmentDecision, assignmentEnd, assignmentReplacement, today } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { FormField, SearchSelect } from '../../shared/ui/FormControls.jsx';
import { Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { InputField, primaryStyle } from '../organization/components/Fields.jsx';
import { useAssignmentWrite, useCandidateOptions } from './api.js';

const schemaFor = { end: assignmentEnd, replace: assignmentReplacement };
export function DecisionDialog({ action, rows, batch = false, onClose }) {
  const { t } = useTranslation('common');
  const [row] = rows;
  const mutation = useAssignmentWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fields = { ...serverFields };
  const {
    control,
    handleSubmit,
    setValue,
    unregister,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schemaFor[action] ?? assignmentDecision),
    defaultValues:
      action === 'end'
        ? { endDate: today(), reason: '' }
        : action === 'replace'
          ? { fromDate: '', animateurId: '', reason: '' }
          : {},
  });
  const values = useWatch({ control });
  const set = (name) => (value) =>
    value || name !== 'note' ? setValue(name, value, { shouldValidate: true }) : unregister(name);
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const useOptions = (q) =>
    useCandidateOptions(
      row.campaignId,
      { wilayaId: row.pointOfSale.wilayaId, from: values.fromDate, to: row.endDate, q },
      t,
    );
  return (
    <Modal title={t('assignments.' + action)} onClose={onClose}>
      <form
        className="grid gap-3"
        onSubmit={handleSubmit((body) => {
          mutation.mutate(
            {
              method: 'post',
              path: batch ? '/assignments/decisions' : '/assignments/' + row.id + '/' + action,
              body: batch ? rows.map(({ id }) => ({ id, decision: action, ...body })) : body,
            },
            { onSuccess: onClose },
          );
        })}
      >
        <p className="text-sm">{t('assignments.selected', { count: rows.length })}</p>
        {action === 'end' && (
          <InputField
            name="endDate"
            type="date"
            value={values.endDate}
            onChange={set('endDate')}
            fields={fields}
            required
          />
        )}
        {action === 'replace' && (
          <>
            <InputField
              name="from"
              type="date"
              value={values.fromDate}
              onChange={set('fromDate')}
              fields={{ from: fields.fromDate }}
              required
            />
            <FormField label={t('roles.animateur')} error={fields.animateurId}>
              {(props) => (
                <SearchSelect
                  {...props}
                  useOptions={useOptions}
                  value={values.animateurId}
                  onChange={set('animateurId')}
                />
              )}
            </FormField>
          </>
        )}
        {['reject', 'end', 'replace'].includes(action) && (
          <InputField
            name={action === 'reject' ? 'note' : 'reason'}
            label="reason"
            value={values[action === 'reject' ? 'note' : 'reason']}
            onChange={set(action === 'reject' ? 'note' : 'reason')}
            fields={fields}
            required
          />
        )}
        <Toast error message={message} />
        <div>
          <button className={primaryStyle} disabled={mutation.isPending}>
            {t('admin.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
