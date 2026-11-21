import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../../shared/auth/hooks.js';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FormField, SearchSelect, TextInput } from '../../../shared/ui/FormControls.jsx';
import { EmptyState, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { actionStyle, primaryStyle, SelectField } from '../../organization/components/Fields.jsx';
import { PasswordDialog } from '../../organization/components/PasswordDialog.jsx';
import { useCampaignResource, useCampaignWrite, useStaffOptions } from '../api.js';

/** Who a team action is for: a supervisor acts for himself, the director for the chosen one. */
const forSupervisor = (user, supervisorId) => (user.role === 'supervisor' ? {} : { supervisorId });

function PickExisting({ campaign, supervisor, members, onClose }) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const [animateurId, setAnimateurId] = useState('');
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const taken = new Set(members.map((row) => row.animateur.id));
  const useOptions = (search) => {
    const result = useStaffOptions(search, 'animateur');
    return { ...result, options: result.options.filter((item) => !taken.has(item.value)) };
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(
          {
            method: 'post',
            path: '/campaigns/' + campaign.id + '/team',
            body: { animateurId, ...forSupervisor(user, supervisor.user.id) },
          },
          { onSuccess: onClose },
        );
      }}
    >
      <FormField label={t('team.choose')}>
        {(props) => (
          <SearchSelect
            {...props}
            useOptions={useOptions}
            value={animateurId}
            onChange={setAnimateurId}
          />
        )}
      </FormField>
      <Toast error message={message} />
      <div>
        <button className={primaryStyle} disabled={!animateurId || mutation.isPending}>
          {t('team.add')}
        </button>
      </div>
    </form>
  );
}

function CreateNew({ campaign, supervisor, wilayaOptions, onCreated }) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    wilayaId: String(wilayaOptions[0]?.value ?? ''),
  });
  const mutation = useCampaignWrite();
  const { message, fields } = useApiError(mutation.error);
  const set = (name) => (event) => setForm({ ...form, [name]: event.target.value });
  const text = (name, label, props = {}) => (
    <FormField label={t('admin.' + label)} error={fields?.[name]}>
      {(input) => <TextInput {...input} {...props} value={form[name]} onChange={set(name)} />}
    </FormField>
  );
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate(
          {
            method: 'post',
            path: '/campaigns/' + campaign.id + '/team/new',
            body: {
              fullName: form.fullName,
              email: form.email,
              ...(form.phone ? { phone: form.phone } : {}),
              wilayaId: Number(form.wilayaId),
              ...forSupervisor(user, supervisor.user.id),
            },
          },
          { onSuccess: (result) => onCreated(result.temporaryPassword) },
        );
      }}
    >
      {text('fullName', 'fullName', { required: true })}
      {text('email', 'email', { type: 'email', required: true })}
      {text('phone', 'phone', { type: 'tel', placeholder: '0555 12 34 56' })}
      <SelectField
        name="wilaya"
        fields={{ wilaya: fields?.wilayaId }}
        value={form.wilayaId}
        options={wilayaOptions}
        onChange={(value) => setForm({ ...form, wilayaId: value })}
      />
      <p className="text-sm text-muted">{t('team.wilayaHint')}</p>
      <Toast error message={message} />
      <div>
        <button
          className={primaryStyle}
          disabled={!form.fullName || !form.email || !form.wilayaId || mutation.isPending}
        >
          {t('team.create')}
        </button>
      </div>
    </form>
  );
}

function AddDialog({ campaign, supervisor, members, wilayaOptions, onClose }) {
  const { t } = useTranslation('common');
  const [mode, setMode] = useState('pick');
  const [password, setPassword] = useState(null);
  if (password) {
    return (
      <PasswordDialog
        value={password}
        onClose={() => {
          setPassword(null);
          onClose();
        }}
      />
    );
  }
  return (
    <Modal title={t('team.add') + ' · ' + supervisor.user.fullName} onClose={onClose}>
      <div className="grid gap-4">
        <div role="group" className="flex flex-wrap gap-2">
          {['pick', 'create'].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              className={mode === value ? primaryStyle : actionStyle}
              onClick={() => setMode(value)}
            >
              {t('team.' + value)}
            </button>
          ))}
        </div>
        {mode === 'pick' ? (
          <PickExisting
            campaign={campaign}
            supervisor={supervisor}
            members={members}
            onClose={onClose}
          />
        ) : (
          <>
            <p className="text-sm">{t('team.passwordHint')}</p>
            <CreateNew
              campaign={campaign}
              supervisor={supervisor}
              wilayaOptions={wilayaOptions}
              onCreated={setPassword}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

function SupervisorTeam({ campaign, supervisor, members, canEdit, canAct }) {
  const { t, i18n } = useTranslation('common');
  const { user } = useAuth();
  const [dialog, setDialog] = useState(null);
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage);
  const required = supervisor.requiredAnimateurs;
  const full = supervisor.teamCount >= required;
  const wilayaOptions = campaign.wilayas
    .filter(({ staff }) =>
      staff.some((member) => member.role === 'supervisor' && member.user.id === supervisor.user.id),
    )
    .map((row) => ({
      value: row.wilayaId,
      label: i18n.resolvedLanguage === 'ar' ? row.wilaya.nameAr : row.wilaya.nameEn,
    }));
  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">{supervisor.user.fullName}</h3>
        <span className="text-sm">
          {t('team.progress', {
            count: number.format(members.length),
            required: number.format(required),
          })}
        </span>
      </div>
      {required === 0 && <p className="mt-2 text-sm text-muted">{t('team.noQuota')}</p>}
      {required > 0 && full && <p className="mt-2 text-sm text-muted">{t('team.full')}</p>}
      <ul className="mt-3 grid gap-2 text-sm">
        {members.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>{row.animateur.fullName}</span>
            {canEdit && canAct && (
              <button
                type="button"
                className={actionStyle}
                aria-label={t('team.remove') + ' ' + row.animateur.fullName}
                onClick={() => setDialog({ type: 'remove', row })}
              >
                {t('team.remove')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {members.length === 0 && <p className="mt-2 text-sm text-muted">{t('team.empty')}</p>}
      {canEdit && canAct && !full && (
        <div className="mt-3">
          <button type="button" className={actionStyle} onClick={() => setDialog({ type: 'add' })}>
            {t('team.add')}
          </button>
        </div>
      )}
      {dialog?.type === 'add' && (
        <AddDialog
          campaign={campaign}
          supervisor={supervisor}
          members={members}
          wilayaOptions={wilayaOptions}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'remove' && (
        <ConfirmDialog
          title={t('team.remove')}
          message={dialog.row.animateur.fullName}
          pending={mutation.isPending}
          onClose={() => {
            setDialog(null);
            mutation.reset();
          }}
          onConfirm={() =>
            mutation.mutate(
              {
                method: 'delete',
                path: '/campaigns/' + campaign.id + '/team/' + dialog.row.animateur.id,
              },
              { onSuccess: () => setDialog(null) },
            )
          }
        >
          <Toast error message={message} />
        </ConfirmDialog>
      )}
      {user.role !== 'supervisor' && !canAct && (
        <p className="mt-2 text-sm text-muted">{t('team.readOnlyHint')}</p>
      )}
    </li>
  );
}

/**
 * The Animateurs each supervisor brought to the campaign. A supervisor sees and edits only his own
 * team; the director and the regional manager see the teams and may act for a supervisor.
 */
export function TeamTab({ campaign, canEdit }) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const team = useCampaignResource('/campaigns/' + campaign.id + '/team');
  const { message } = useApiError(team.error);
  const members = team.data?.data ?? [];
  const supervisors = campaign.wilayas
    .flatMap(({ staff }) => staff)
    .filter((member) => member.role === 'supervisor')
    .filter((member) => user.role !== 'supervisor' || member.user.id === user.id);
  // One card per person, even when a supervisor covers several wilayas.
  const cards = [...new Map(supervisors.map((member) => [member.user.id, member])).values()].map(
    (first) => {
      const rows = supervisors.filter((member) => member.user.id === first.user.id);
      return {
        ...first,
        requiredAnimateurs: rows.reduce((sum, row) => sum + row.requiredAnimateurs, 0),
        teamCount: first.teamCount ?? 0,
      };
    },
  );
  return (
    <div className="grid gap-4">
      <Toast error message={message} />
      {team.isPending && <p role="status">{t('admin.loading')}</p>}
      {!team.isPending && cards.length === 0 && <EmptyState />}
      <ul className="grid gap-3">
        {cards.map((supervisor) => (
          <SupervisorTeam
            key={supervisor.user.id}
            campaign={campaign}
            supervisor={supervisor}
            members={members.filter((row) => row.supervisorId === supervisor.user.id)}
            canEdit={canEdit}
            canAct={['supervisor', 'director', 'regional_manager'].includes(user.role)}
          />
        ))}
      </ul>
    </div>
  );
}
