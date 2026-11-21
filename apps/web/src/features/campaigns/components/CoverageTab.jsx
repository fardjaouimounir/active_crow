import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FormField, SearchSelect, TextInput } from '../../../shared/ui/FormControls.jsx';
import { EmptyState, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useWilayas } from '../../organization/api.js';
import {
  actionStyle,
  areaOptions,
  primaryStyle,
  SelectField,
} from '../../organization/components/Fields.jsx';
import { useCampaignWrite, useStaffOptions } from '../api.js';

function StaffDialog({ campaign, wilayaId, role, onClose }) {
  const { t } = useTranslation('common');
  const [userId, setUserId] = useState('');
  const [quota, setQuota] = useState('');
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const useOptions = (search) => useStaffOptions(search, role);
  return (
    <Modal title={t('campaigns.add_' + role)} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(
            {
              method: 'post',
              path: '/campaigns/' + campaign.id + '/staff',
              body: {
                userId,
                wilayaId,
                role,
                ...(role === 'supervisor' ? { requiredAnimateurs: Number(quota) } : {}),
              },
            },
            { onSuccess: onClose },
          );
        }}
      >
        <FormField label={t('roles.' + role)}>
          {(props) => (
            <SearchSelect {...props} useOptions={useOptions} value={userId} onChange={setUserId} />
          )}
        </FormField>
        {role === 'supervisor' && (
          <FormField label={t('campaigns.requiredPerSupervisor')}>
            {(props) => (
              <TextInput
                {...props}
                type="number"
                min={0}
                max={500}
                required
                value={quota}
                onChange={(event) => setQuota(event.target.value)}
              />
            )}
          </FormField>
        )}
        <Toast error message={message} />
        <div>
          <button
            className={primaryStyle}
            disabled={!userId || (role === 'supervisor' && quota === '') || mutation.isPending}
          >
            {t('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function QuotaDialog({ campaign, member, onClose }) {
  const { t } = useTranslation('common');
  const [quota, setQuota] = useState(String(member.requiredAnimateurs));
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  return (
    <Modal title={t('campaigns.quotaTitle') + ' · ' + member.user.fullName} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(
            {
              method: 'patch',
              path: '/campaigns/' + campaign.id + '/staff/' + member.id,
              body: { requiredAnimateurs: Number(quota) },
            },
            { onSuccess: onClose },
          );
        }}
      >
        <FormField label={t('campaigns.requiredPerSupervisor')}>
          {(props) => (
            <TextInput
              {...props}
              type="number"
              min={member.teamCount ?? 0}
              max={500}
              required
              value={quota}
              onChange={(event) => setQuota(event.target.value)}
            />
          )}
        </FormField>
        <Toast error message={message} />
        <div>
          <button className={primaryStyle} disabled={quota === '' || mutation.isPending}>
            {t('admin.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** FR-031: target wilayas with required Animateurs, and the staff of each wilaya. */
export function CoverageTab({ campaign, canEdit }) {
  const { t, i18n } = useTranslation('common');
  const wilayas = useWilayas();
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const [newWilaya, setNewWilaya] = useState('');
  const [dialog, setDialog] = useState(null);
  const names = areaOptions(wilayas.data?.data, i18n.resolvedLanguage);
  const nameOf = (id) => names.find((item) => item.value === id)?.label ?? id;
  // The need of a wilaya is the sum of its supervisors' numbers: only wilayas are sent.
  const current = campaign.wilayas.map(({ wilayaId }) => ({ wilayaId }));
  const save = (rows) =>
    mutation.mutate({
      method: 'put',
      path: '/campaigns/' + campaign.id + '/wilayas',
      body: { wilayas: rows },
    });
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const available = names.filter(
    (item) => !campaign.wilayas.some((row) => row.wilayaId === item.value),
  );

  return (
    <div className="grid gap-4">
      <Toast error message={message} />
      {canEdit && (
        <div className="flex flex-wrap items-end gap-3">
          <SelectField
            name="wilaya"
            value={newWilaya}
            options={available}
            onChange={setNewWilaya}
          />
          <button
            type="button"
            className={actionStyle}
            disabled={!newWilaya || mutation.isPending}
            onClick={() => {
              save([...current, { wilayaId: Number(newWilaya) }]);
              setNewWilaya('');
            }}
          >
            {t('campaigns.addWilaya')}
          </button>
        </div>
      )}
      {!campaign.wilayas.length && <EmptyState />}
      <ul className="grid gap-3">
        {campaign.wilayas.map((row) => (
          <li key={row.wilayaId} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold">{nameOf(row.wilayaId)}</h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">
                  {t('campaigns.requiredAnimateurs')}: {number.format(row.requiredAnimateurs)}
                </span>
                {canEdit && (
                  <button
                    type="button"
                    className={actionStyle}
                    aria-label={t('campaigns.removeWilaya') + ' ' + nameOf(row.wilayaId)}
                    onClick={() => setDialog({ type: 'wilaya', wilayaId: row.wilayaId })}
                  >
                    {t('campaigns.removeWilaya')}
                  </button>
                )}
              </div>
            </div>
            <ul className="mt-3 grid gap-2 text-sm">
              {row.staff.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {member.user.fullName} · {t('roles.' + member.role)}
                    {member.role === 'supervisor' && (
                      <>
                        {' · '}
                        {t('campaigns.teamProgress', {
                          count: number.format(member.teamCount ?? 0),
                          required: number.format(member.requiredAnimateurs),
                        })}
                      </>
                    )}
                  </span>
                  {canEdit && member.role === 'supervisor' && (
                    <button
                      type="button"
                      className={actionStyle}
                      aria-label={t('campaigns.editQuota') + ' ' + member.user.fullName}
                      onClick={() => setDialog({ type: 'quota', member })}
                    >
                      {t('campaigns.editQuota')}
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className={actionStyle}
                      aria-label={t('campaigns.removeStaff') + ' ' + member.user.fullName}
                      onClick={() => setDialog({ type: 'staff', member })}
                    >
                      {t('campaigns.removeStaff')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-3 flex flex-wrap gap-2">
                {['regional_manager', 'supervisor'].map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={actionStyle}
                    disabled={
                      role === 'regional_manager' &&
                      row.staff.some((member) => member.role === 'regional_manager')
                    }
                    onClick={() => setDialog({ type: 'add', role, wilayaId: row.wilayaId })}
                  >
                    {t('campaigns.add_' + role)}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {dialog?.type === 'quota' && (
        <QuotaDialog campaign={campaign} member={dialog.member} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'add' && (
        <StaffDialog
          campaign={campaign}
          wilayaId={dialog.wilayaId}
          role={dialog.role}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog?.type === 'staff' || dialog?.type === 'wilaya') && (
        <ConfirmDialog
          title={t(dialog.type === 'staff' ? 'campaigns.removeStaff' : 'campaigns.removeWilaya')}
          message={t('admin.confirmChange')}
          pending={mutation.isPending}
          onClose={() => {
            setDialog(null);
            mutation.reset();
          }}
          onConfirm={() =>
            mutation.mutate(
              dialog.type === 'staff'
                ? {
                    method: 'delete',
                    path: '/campaigns/' + campaign.id + '/staff/' + dialog.member.id,
                  }
                : {
                    method: 'put',
                    path: '/campaigns/' + campaign.id + '/wilayas',
                    body: { wilayas: current.filter((row) => row.wilayaId !== dialog.wilayaId) },
                  },
              { onSuccess: () => setDialog(null) },
            )
          }
        >
          <Toast error message={message} />
        </ConfirmDialog>
      )}
    </div>
  );
}
