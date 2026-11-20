import { announcementPublish, announcementRoles } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { FormField } from '../../shared/ui/FormControls.jsx';
import { EmptyState, PageHeader, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useCampaigns } from '../campaigns/api.js';
import { useCommunication, useCommunicationWrite } from '../notifications/api.js';
import { useWilayas } from '../organization/api.js';
import {
  InputField,
  SelectField,
  actionStyle,
  areaOptions,
  primaryStyle,
} from '../organization/components/Fields.jsx';

function Compose({ close }) {
  const { t, i18n } = useTranslation('common');
  const { user } = useAuth();
  const allowed = user.role === 'supervisor' ? ['animateur'] : announcementRoles;
  const campaigns = useCampaigns({ pageSize: 100 });
  const wilayas = useWilayas();
  const form = useForm({
    resolver: zodResolver(announcementPublish),
    defaultValues: { title: '', body: '', targetRoles: [] },
  });
  const values = useWatch({ control: form.control });
  const preview = useCommunication(
    '/announcements/audience-preview',
    {
      campaignId: values.campaignId,
      wilayaId: values.wilayaId,
      targetRoles: values.targetRoles.join(','),
    },
    { enabled: values.targetRoles.length > 0 },
  );
  const mutation = useCommunicationWrite();
  const { message } = useApiError(mutation.error ?? preview.error);
  const errors = Object.fromEntries(
    Object.keys(form.formState.errors).map((key) => [key, t('admin.invalidField')]),
  );
  const optional = (name, value) =>
    value
      ? form.setValue(name, name === 'wilayaId' ? Number(value) : value)
      : form.unregister(name);
  return (
    <Modal title={t('announcements.compose')} onClose={close}>
      <form
        className="grid gap-3"
        onSubmit={form.handleSubmit((body) =>
          mutation.mutate({ path: '/announcements', body }, { onSuccess: close }),
        )}
      >
        <InputField
          name="title"
          fields={errors}
          value={values.title}
          onChange={(value) => form.setValue('title', value)}
        />
        <FormField label={t('announcements.body')} error={errors.body}>
          {(props) => (
            <textarea
              {...props}
              {...form.register('body')}
              rows={4}
              className="rounded border p-2"
            />
          )}
        </FormField>
        <SelectField
          name="campaign"
          blank="all"
          value={values.campaignId}
          options={(campaigns.data?.data ?? []).map(({ id, name }) => ({ value: id, label: name }))}
          onChange={(value) => optional('campaignId', value)}
        />
        <SelectField
          name="wilaya"
          blank="all"
          value={values.wilayaId}
          options={areaOptions(wilayas.data?.data, i18n.resolvedLanguage)}
          onChange={(value) => optional('wilayaId', value)}
        />
        <fieldset className="grid gap-2">
          <legend className="font-medium">{t('announcements.audience')}</legend>
          {allowed.map((role) => (
            <label key={role} className="flex gap-2">
              <input
                type="checkbox"
                checked={values.targetRoles.includes(role)}
                onChange={(event) =>
                  form.setValue(
                    'targetRoles',
                    event.target.checked
                      ? [...values.targetRoles, role]
                      : values.targetRoles.filter((value) => value !== role),
                  )
                }
              />
              {t('roles.' + role)}
            </label>
          ))}
          {errors.targetRoles && <p role="alert">{errors.targetRoles}</p>}
        </fieldset>
        <p role="status">
          {values.targetRoles.length && preview.isPending
            ? t('admin.loading')
            : t('announcements.count', { count: preview.data?.data.count ?? 0 })}
        </p>
        <Toast error message={message} />
        <div>
          <button
            className={primaryStyle}
            disabled={mutation.isPending || !preview.data?.data.count}
          >
            {t('announcements.publish')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Receipts({ id }) {
  const { t } = useTranslation('common');
  const query = useCommunication('/announcements/' + id + '/reads');
  const { message } = useApiError(query.error);
  const receipts = query.data?.data;
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (message) return <Toast error message={message} />;
  return (
    <section className="grid gap-2 sm:grid-cols-2">
      {['read', 'notRead'].map((key) => (
        <div key={key} className="rounded border bg-surface p-3">
          <h2 className="font-medium">{t('announcements.' + key)}</h2>
          <ul className="text-sm">
            {receipts[key].map(({ id, fullName }) => (
              <li key={id}>{fullName}</li>
            ))}
          </ul>
          {!receipts[key].length && <p>—</p>}
        </div>
      ))}
    </section>
  );
}
export function AnnouncementDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const navigate = useNavigate();
  const query = useCommunication('/announcements/' + id, undefined, {
    refetchOnWindowFocus: false,
  });
  const { message } = useApiError(query.error);
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (message) return <Toast error message={message} />;
  const row = query.data.data;
  return (
    <div className="space-y-4">
      <PageHeader title={row.title}>
        <button
          type="button"
          className={actionStyle}
          onClick={() => navigate('/app/announcements')}
        >
          {t('admin.back')}
        </button>
      </PageHeader>
      <article className="grid gap-2 rounded border bg-surface p-4">
        <strong>{row.author.fullName}</strong>
        <p className="whitespace-pre-wrap break-words">{row.body}</p>
      </article>
      {(user.id === row.authorId || user.role === 'director') && <Receipts id={id} />}
    </div>
  );
}
export function AnnouncementsPage() {
  const { t } = useTranslation('common');
  const canPublish = useCan('announcement.publish');
  const [compose, setCompose] = useState(false);
  const { filters, setFilter } = useFilters();
  const query = useCommunication('/announcements', { page: filters.page }, { staleTime: 0 });
  const { message } = useApiError(query.error);
  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  return (
    <>
      <PageHeader title={t('admin.announcements')}>
        {canPublish && (
          <button type="button" className={primaryStyle} onClick={() => setCompose(true)}>
            {t('announcements.compose')}
          </button>
        )}
      </PageHeader>
      {query.isPending && <p role="status">{t('admin.loading')}</p>}
      <Toast error message={message} />
      {query.isSuccess && !rows.length && <EmptyState />}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              className={
                'block rounded border p-3 ' +
                (row.readAt ? 'bg-surface' : 'bg-info-soft font-semibold')
              }
              to={'/app/announcements/' + row.id}
            >
              {row.title}
              <span className="ms-2 text-sm font-normal">{row.author.fullName}</span>
            </Link>
          </li>
        ))}
      </ul>
      {meta && (
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            disabled={meta.page <= 1}
            onClick={() => setFilter('page', meta.page - 1)}
          >
            {t('admin.previous')}
          </button>
          <button
            type="button"
            disabled={meta.page * meta.pageSize >= meta.total}
            onClick={() => setFilter('page', meta.page + 1)}
          >
            {t('admin.next')}
          </button>
        </div>
      )}
      {compose && <Compose close={() => setCompose(false)} />}
    </>
  );
}
