import { today } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useParams } from 'react-router';
import { useAuth, useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { EmptyState, PageHeader, StatusBadge, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useCommunes, useOrganizationResource, useOrganizationWrite, useWilayas } from '../api.js';
import { actionStyle } from '../components/Fields.jsx';
import { PasswordDialog } from '../components/PasswordDialog.jsx';
import { TransferDialog } from '../components/TransferDialog.jsx';
import { managerRoles, UserForm } from '../components/UserForm.jsx';

const endpoint = {
  suspend: 'suspend',
  markLeft: 'mark-left',
  reactivate: 'reactivate',
  resetPassword: 'reset-password',
  cancelTransfer: 'transfers/scheduled',
};
const teamRoles = ['supervisor', 'regional_manager', 'general_manager'];

export function UserDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const { t, i18n } = useTranslation('common');
  const { user: actor } = useAuth();
  const canManage = useCan('org.user.manage');
  const canTransfer = useCan('org.transfer');
  const path = '/users/' + id;
  const details = useOrganizationResource(path);
  const wilayas = useWilayas();
  const communes = useCommunes(details.data?.data.user.wilayaId);
  const mutation = useOrganizationWrite();
  const [action, setAction] = useState(null);
  const [temporaryPassword, setPassword] = useState(null);
  const [saved, setSaved] = useState(false);
  const error = useApiError(details.error);
  const actionError = useApiError(mutation.error);
  const close = () => {
    setAction(null);
    mutation.reset();
  };
  const success = () => {
    close();
    setSaved(true);
  };
  if (details.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (details.isError) return <Toast error message={error.message} />;
  const { user, profile, currentManager, reportingLines } = details.data.data;
  const placeName = (places, id) => {
    const place = places?.find((item) => item.id === id);
    return place ? (i18n.resolvedLanguage === 'ar' ? place.nameAr : place.nameEn) : (id ?? '—');
  };
  const at = today();
  const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone: 'Africa/Algiers',
    dateStyle: 'medium',
  });
  const hasScheduled = reportingLines.some((item) => item.validFrom.slice(0, 10) > at);
  const actions = [
    canManage && 'edit',
    canManage && user.status === 'active' && user.id !== actor?.id && 'suspend',
    canManage && user.status !== 'active' && 'reactivate',
    canManage && user.status !== 'left' && user.id !== actor?.id && 'markLeft',
    canManage && 'resetPassword',
    canTransfer && managerRoles[user.role] && user.status !== 'left' && !hasScheduled && 'transfer',
    canTransfer && teamRoles.includes(user.role) && 'transferTeam',
    canTransfer && hasScheduled && 'cancelTransfer',
  ].filter(Boolean);
  return (
    <>
      <PageHeader title={user.fullName}>
        <Link
          className={actionStyle}
          to={{ pathname: '/app/users', search: location.state?.listSearch ?? '' }}
        >
          {t('admin.users')}
        </Link>
      </PageHeader>
      {saved && <Toast message={t('admin.saved')} />}
      <div className="my-4 flex flex-wrap gap-2">
        {actions.map((item) => (
          <button
            type="button"
            className={actionStyle}
            key={item}
            onClick={() => {
              setSaved(false);
              setAction(item);
            }}
          >
            {t('admin.' + item)}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-semibold">{t('admin.details')}</h2>
          <dl className="grid gap-3 text-sm">
            <div>
              <dt className="font-medium">{t('admin.role')}</dt>
              <dd>{t('roles.' + user.role)}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('admin.status')}</dt>
              <dd>
                <StatusBadge tone={user.status === 'active' ? 'good' : 'neutral'}>
                  {t('admin.' + user.status)}
                </StatusBadge>
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t('admin.email')}</dt>
              <dd>
                <bdi dir="ltr">{user.email}</bdi>
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t('admin.phone')}</dt>
              <dd>
                <bdi dir="ltr">{user.phone ?? '—'}</bdi>
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t('admin.currentManager')}</dt>
              <dd>
                {currentManager ? (
                  <Link to={'/app/users/' + currentManager.id} className="underline">
                    {currentManager.fullName}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="font-medium">{t('admin.wilaya')}</dt>
              <dd>{placeName(wilayas.data?.data, user.wilayaId)}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('admin.commune')}</dt>
              <dd>{placeName(communes.data?.data, user.communeId)}</dd>
            </div>
            {profile &&
              ['experienceYears', 'skills', 'languages', 'notes'].map((key) => (
                <div key={key}>
                  <dt className="font-medium">{t('admin.' + key)}</dt>
                  <dd>
                    {Array.isArray(profile[key])
                      ? profile[key].join(', ') || '—'
                      : (profile[key] ?? '—')}
                  </dd>
                </div>
              ))}
          </dl>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 font-semibold">{t('admin.reportingLines')}</h2>
          {!reportingLines.length && <EmptyState />}
          <ol className="space-y-3">
            {reportingLines.map((line) => (
              <li key={line.id} className="border-s-2 border-slate-200 ps-3 text-sm">
                <p>
                  {dateFormat.format(new Date(line.validFrom))} –{' '}
                  {line.validTo ? dateFormat.format(new Date(line.validTo)) : t('admin.ongoing')}
                </p>
                <Link className="underline" to={'/app/users/' + line.managerId}>
                  {line.manager?.fullName ?? t('admin.manager')}
                </Link>
                {line.reason && <p>{line.reason}</p>}
                {line.validFrom.slice(0, 10) > at && (
                  <StatusBadge tone="warn">{t('admin.scheduled')}</StatusBadge>
                )}
              </li>
            ))}
          </ol>
        </section>
      </div>
      {action === 'edit' && (
        <Modal title={t('admin.edit')} onClose={close}>
          <UserForm user={user} profile={profile} onSuccess={success} />
        </Modal>
      )}
      {(action === 'transfer' || action === 'transferTeam') && (
        <TransferDialog
          user={user}
          team={action === 'transferTeam'}
          onClose={close}
          onSuccess={success}
        />
      )}
      {endpoint[action] && (
        <ConfirmDialog
          title={t('admin.' + action)}
          message={t('admin.confirmChange')}
          pending={mutation.isPending}
          onClose={close}
          onConfirm={() =>
            mutation.mutate(
              {
                method: action === 'cancelTransfer' ? 'delete' : 'post',
                path: path + '/' + endpoint[action],
              },
              {
                onSuccess: (result) => {
                  if (result?.temporaryPassword) setPassword(result.temporaryPassword);
                  success();
                },
              },
            )
          }
        >
          <Toast error message={actionError.message} />
        </ConfirmDialog>
      )}
      {temporaryPassword && (
        <PasswordDialog value={temporaryPassword} onClose={() => setPassword(null)} />
      )}
    </>
  );
}
