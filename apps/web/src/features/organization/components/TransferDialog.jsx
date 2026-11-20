import { today } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../../shared/ui/Dialogs.jsx';
import { DatePicker, FormField } from '../../../shared/ui/FormControls.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useOrganizationWrite } from '../api.js';
import { InputField, primaryStyle } from './Fields.jsx';
import { ManagerField, managerRoles } from './UserForm.jsx';

export function TransferDialog({ user, team, onClose, onSuccess }) {
  const { t } = useTranslation('common');
  const [newManagerId, setManager] = useState('');
  const [effectiveDate, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const mutation = useOrganizationWrite();
  const { message, fields } = useApiError(mutation.error);
  const roles = team
    ? user.role === 'general_manager'
      ? ['general_manager', 'director']
      : [user.role]
    : managerRoles[user.role];
  const max = new Date(today());
  max.setUTCDate(max.getUTCDate() + 90);
  return (
    <Modal title={t(team ? 'admin.transferTeam' : 'admin.transfer')} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(
            {
              method: 'post',
              path: '/users/' + user.id + '/transfers' + (team ? '/team' : ''),
              body: { newManagerId, effectiveDate, reason },
            },
            { onSuccess },
          );
        }}
      >
        <ManagerField
          roles={roles}
          value={newManagerId}
          onChange={setManager}
          error={fields.newManagerId ?? fields.managerId}
          required
        />
        <FormField label={t('admin.effectiveDate')} error={fields.effectiveDate}>
          {(props) => (
            <DatePicker
              {...props}
              min={today()}
              max={max.toISOString().slice(0, 10)}
              value={effectiveDate}
              required
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </FormField>
        <InputField
          name="reason"
          fields={fields}
          value={reason}
          onChange={setReason}
          required
          maxLength={1000}
        />
        <Toast error message={message} />
        <div>
          <button className={primaryStyle} disabled={mutation.isPending}>
            {t('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
