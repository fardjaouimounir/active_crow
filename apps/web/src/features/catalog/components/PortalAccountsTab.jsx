import { createPortalUserFormSchema } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FilterBar, useFilters } from '../../../shared/ui/FilterBar.jsx';
import { StatusBadge, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { actionStyle, InputField, primaryStyle } from '../../organization/components/Fields.jsx';
import { PasswordDialog } from '../../organization/components/PasswordDialog.jsx';
import { useCatalogWrite, useClientList } from '../api.js';

const FIELDS = [
  ['fullName', 'text'],
  ['email', 'email'],
  ['phone', 'tel'],
];
/** The existing user actions (Prompt 04), unchanged. */
const ACTIONS = { suspend: 'suspend', reactivate: 'reactivate', resetPassword: 'reset-password' };

function PortalUserForm({ clientId, onSuccess }) {
  const { t } = useTranslation('common');
  const {
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createPortalUserFormSchema),
    defaultValues: { fullName: '', email: '', phone: null },
  });
  const values = useWatch({ control });
  const mutation = useCatalogWrite();
  const { message, fields: serverFields } = useApiError(mutation.error);
  const fields = { ...serverFields };
  for (const key of Object.keys(errors)) fields[key] = t('admin.invalidField');
  const onSubmit = handleSubmit(async (body) => {
    try {
      const result = await mutation.mutateAsync({
        method: 'post',
        path: '/users',
        body: { ...body, role: 'client', clientId },
      });
      onSuccess(result.temporaryPassword);
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
          required={name !== 'phone'}
          onChange={(value) =>
            setValue(name, name === 'phone' ? value || null : value, { shouldValidate: true })
          }
        />
      ))}
      <Toast error message={message} />
      <div>
        <button className={primaryStyle} disabled={mutation.isPending}>
          {t('admin.save')}
        </button>
      </div>
    </form>
  );
}

/** Portal accounts of one client (Q-16): create, suspend, reactivate, reset password. */
export function PortalAccountsTab({ clientId }) {
  const { t } = useTranslation('common');
  const manage = useCan('org.user.manage');
  const { filters, setFilter } = useFilters();
  const page = Number(filters.page) || 1;
  const list = useClientList(clientId, 'users', { page });
  const { message } = useApiError(list.error);
  const mutation = useCatalogWrite();
  const actionError = useApiError(mutation.error);
  const [dialog, setDialog] = useState(null);
  const [password, setPassword] = useState(null);
  const close = () => {
    setDialog(null);
    mutation.reset();
  };
  const columns = [
    { accessorKey: 'fullName', header: t('admin.fullName') },
    {
      accessorKey: 'email',
      header: t('admin.email'),
      cell: ({ getValue }) => <bdi dir="ltr">{getValue()}</bdi>,
    },
    {
      accessorKey: 'status',
      header: t('admin.status'),
      cell: ({ getValue }) => (
        <StatusBadge tone={getValue() === 'active' ? 'good' : 'neutral'}>
          {t('admin.' + getValue())}
        </StatusBadge>
      ),
    },
    ...(manage
      ? [
          {
            id: 'actions',
            header: t('catalog.actions'),
            cell: ({ row }) => {
              const user = row.original;
              const available = [
                user.status === 'active' && 'suspend',
                user.status !== 'active' && 'reactivate',
                'resetPassword',
              ].filter(Boolean);
              return (
                <div className="flex flex-wrap gap-2">
                  {available.map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={actionStyle}
                      aria-label={t('admin.' + action) + ' ' + user.fullName}
                      onClick={() => setDialog({ action, user })}
                    >
                      {t('admin.' + action)}
                    </button>
                  ))}
                </div>
              );
            },
          },
        ]
      : []),
  ];
  return (
    <>
      {manage && (
        <FilterBar>
          <button
            type="button"
            className={primaryStyle}
            onClick={() => setDialog({ action: 'create' })}
          >
            {t('catalog.newPortalUser')}
          </button>
        </FilterBar>
      )}
      <DataTable
        columns={columns}
        rows={list.data?.data ?? []}
        {...list.data?.meta}
        page={page}
        loading={list.isPending}
        error={message}
        onPage={(value) => setFilter('page', value)}
      />
      {dialog?.action === 'create' && (
        <Modal title={t('catalog.newPortalUser')} onClose={close}>
          <PortalUserForm
            clientId={clientId}
            onSuccess={(temporaryPassword) => {
              setDialog(null);
              setPassword(temporaryPassword);
            }}
          />
        </Modal>
      )}
      {ACTIONS[dialog?.action] && (
        <ConfirmDialog
          title={t('admin.' + dialog.action)}
          message={t('admin.confirmChange')}
          pending={mutation.isPending}
          onClose={close}
          onConfirm={() =>
            mutation.mutate(
              { method: 'post', path: '/users/' + dialog.user.id + '/' + ACTIONS[dialog.action] },
              {
                onSuccess: (result) => {
                  close();
                  if (result?.temporaryPassword) setPassword(result.temporaryPassword);
                },
              },
            )
          }
        >
          <Toast error message={actionError.message} />
        </ConfirmDialog>
      )}
      {password && <PasswordDialog value={password} onClose={() => setPassword(null)} />}
    </>
  );
}
