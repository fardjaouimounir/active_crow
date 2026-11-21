import { announcementPublish, announcementRoles } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { useFilters } from '../../shared/ui/FilterBar.jsx';
import { FormField } from '../../shared/ui/FormControls.jsx';
import { PageHeader, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { EmptyState } from '../../ui/data.jsx';
import { useFormat } from '../../ui/format.js';
import { Avatar, Button, Skeleton, cn } from '../../ui/primitives.jsx';
import { Ago, Section, Surface } from '../../ui/viz.jsx';
import { useCampaigns } from '../campaigns/api.js';
import { useCommunication, useCommunicationWrite } from '../notifications/api.js';
import { useWilayas } from '../organization/api.js';
import { InputField, SelectField, areaOptions } from '../organization/components/Fields.jsx';

const PAGE = 10;

/** Roles, region and campaign an announcement is aimed at, as small chips. */
function AudienceChips({ row, campaigns, wilayas }) {
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
  const campaign = campaigns?.find((item) => item.id === row.campaignId);
  const wilaya = wilayas?.find((item) => item.value === row.wilayaId);
  const chip =
    'inline-flex h-5 items-center rounded-md border border-line px-1.5 text-2xs text-fg-2';
  return (
    <ul className="flex flex-wrap gap-1" aria-label={tp('announcements.audience')}>
      {row.targetRoles.map((role) => (
        <li key={role} className={chip}>
          {t('roles.' + role)}
        </li>
      ))}
      {wilaya && <li className={chip}>{wilaya.label}</li>}
      {campaign && (
        <li className={cn(chip, 'max-w-48 truncate')}>
          <bdi>{campaign.name}</bdi>
        </li>
      )}
      {row.campaignId == null && row.wilayaId == null && (
        <li className={chip}>{tp('announcements.everywhere')}</li>
      )}
    </ul>
  );
}

function useLookups() {
  const { i18n } = useTranslation('common');
  const campaigns = useCampaigns({ pageSize: 100 });
  const wilayas = useWilayas();
  return {
    campaigns: campaigns.data?.data,
    wilayas: wilayas.data ? areaOptions(wilayas.data.data, i18n.resolvedLanguage) : undefined,
  };
}

/* --------------------------------------------------------------- Composer */

function Compose({ close }) {
  const { t, i18n } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
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
  const count = preview.data?.data.count ?? 0;
  const toggle = (role) =>
    form.setValue(
      'targetRoles',
      values.targetRoles.includes(role)
        ? values.targetRoles.filter((value) => value !== role)
        : [...values.targetRoles, role],
      { shouldValidate: form.formState.isSubmitted },
    );
  return (
    <Modal drawer title={t('announcements.compose')} onClose={close}>
      <form
        className="grid gap-4"
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
              rows={5}
              className="w-full rounded-md border border-control bg-surface p-2.5 text-sm"
            />
          )}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            name="campaign"
            blank="all"
            value={values.campaignId}
            options={(campaigns.data?.data ?? []).map(({ id, name }) => ({
              value: id,
              label: name,
            }))}
            onChange={(value) => optional('campaignId', value)}
          />
          <SelectField
            name="wilaya"
            blank="all"
            value={values.wilayaId}
            options={areaOptions(wilayas.data?.data, i18n.resolvedLanguage)}
            onChange={(value) => optional('wilayaId', value)}
          />
        </div>
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('announcements.audience')}</legend>
          <div className="flex flex-wrap gap-2">
            {allowed.map((role) => {
              const on = values.targetRoles.includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(role)}
                  className={cn(
                    'h-8 rounded-md border px-3 text-sm font-medium transition-colors duration-150',
                    on
                      ? 'border-accent-line bg-accent-soft text-accent-text'
                      : 'border-control bg-surface text-fg-2 hover:bg-sunken',
                  )}
                >
                  {t('roles.' + role)}
                </button>
              );
            })}
          </div>
          {errors.targetRoles && <p role="alert">{errors.targetRoles}</p>}
        </fieldset>
        <Section title={tp('announcements.preview')} hint={tp('announcements.previewHint')}>
          <Surface className="space-y-2 p-3.5">
            <p className="text-sm font-semibold">
              <bdi>{values.title || tp('announcements.previewTitle')}</bdi>
            </p>
            <p className="line-clamp-4 text-sm whitespace-pre-wrap text-fg-2">
              <bdi>{values.body || tp('announcements.previewBody')}</bdi>
            </p>
          </Surface>
          <p role="status" className="mt-2 text-xs text-fg-3">
            {values.targetRoles.length && preview.isPending
              ? t('admin.loading')
              : t('announcements.count', { count })}
          </p>
        </Section>
        <Toast error message={message} />
        <div>
          <Button type="submit" variant="primary" disabled={mutation.isPending || !count}>
            {t('announcements.publish')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- Receipts */

function Receipts({ id }) {
  const { t } = useTranslation('common');
  const query = useCommunication('/announcements/' + id + '/reads');
  const { message } = useApiError(query.error);
  const receipts = query.data?.data;
  if (query.isPending) return <Skeleton className="h-20" />;
  if (message) return <Toast error message={message} />;
  return (
    <section className="grid gap-3 sm:grid-cols-2">
      {['read', 'notRead'].map((key) => (
        <div key={key} className="rounded-lg border border-line bg-surface p-3">
          <h2 className="text-sm font-semibold">
            {t('announcements.' + key)}{' '}
            <span className="tnum font-normal text-fg-3">{receipts[key].length}</span>
          </h2>
          <ul className="mt-1.5 max-h-48 overflow-y-auto text-sm text-fg-2">
            {receipts[key].map(({ id: userId, fullName }) => (
              <li key={userId}>
                <bdi>{fullName}</bdi>
              </li>
            ))}
          </ul>
          {!receipts[key].length && <p className="text-fg-3">—</p>}
        </div>
      ))}
    </section>
  );
}

/** The announcement itself, shared by the side panel and the standalone page. */
function AnnouncementBody({ id }) {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { when } = useFormat();
  const lookups = useLookups();
  const query = useCommunication('/announcements/' + id, undefined, {
    refetchOnWindowFocus: false,
  });
  const { message } = useApiError(query.error);
  if (query.isPending) return <Skeleton className="h-40" />;
  if (message) return <Toast error message={message} />;
  const row = query.data.data;
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <Avatar name={row.author.fullName} size="lg" />
        <div className="leading-tight">
          <p className="text-sm font-semibold">
            <bdi>{row.author.fullName}</bdi>
          </p>
          <p className="text-xs text-fg-3">{when(row.publishedAt ?? row.createdAt)}</p>
        </div>
      </div>
      <AudienceChips row={row} {...lookups} />
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-fg">
        <bdi>{row.body}</bdi>
      </p>
      {(user.id === row.authorId || user.role === 'director') && <Receipts id={id} />}
      <span className="sr-only">{t('announcements.audience')}</span>
    </div>
  );
}

export function AnnouncementDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const query = useCommunication('/announcements/' + id, undefined, {
    refetchOnWindowFocus: false,
  });
  const title = query.data?.data.title;
  return (
    <div className="space-y-4">
      <PageHeader title={title ?? ' '}>
        <Button variant="secondary" onClick={() => navigate('/app/announcements')}>
          {t('admin.back')}
        </Button>
      </PageHeader>
      <Surface className="max-w-3xl p-5">
        <AnnouncementBody id={id} />
      </Surface>
    </div>
  );
}

/* ------------------------------------------------------------------- List */

export function AnnouncementsPage() {
  const { t } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
  const canPublish = useCan('announcement.publish');
  const [compose, setCompose] = useState(false);
  const [size, setSize] = useState(PAGE);
  const { filters, setFilter } = useFilters();
  const query = useCommunication(
    '/announcements',
    { page: 1, pageSize: size },
    { staleTime: 0, placeholderData: keepPreviousData },
  );
  const lookups = useLookups();
  const { message } = useApiError(query.error);
  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const opened = filters.open;
  const unread = rows.filter((row) => !row.readAt).length;
  return (
    <>
      <PageHeader
        title={t('admin.announcements')}
        context={meta ? tp('announcements.context', { total: meta.total, unread }) : undefined}
      >
        {canPublish && (
          <Button variant="primary" onClick={() => setCompose(true)}>
            {t('announcements.compose')}
          </Button>
        )}
      </PageHeader>
      {query.isPending && (
        <div role="status" className="space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-20 rounded-lg" />
          ))}
        </div>
      )}
      <Toast error message={message} />
      {query.isSuccess && !rows.length && (
        <EmptyState title={tp('announcements.emptyTitle')} message={tp('announcements.empty')}>
          {canPublish && (
            <Button size="sm" onClick={() => setCompose(true)}>
              {t('announcements.compose')}
            </Button>
          )}
        </EmptyState>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface empty:hidden">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setFilter('open', row.id)}
              className={cn(
                'flex w-full items-start gap-3.5 px-4 py-3.5 text-start transition-colors duration-150 hover:bg-sunken/60',
                opened === row.id && 'bg-sunken',
              )}
            >
              <span className="mt-2.5 flex size-2 shrink-0" aria-hidden={!!row.readAt}>
                {!row.readAt && <span className="size-2 rounded-full bg-accent" />}
              </span>
              {!row.readAt && <span className="sr-only">{tp('announcements.unread')}</span>}
              <Avatar name={row.author.fullName} />
              <span className="min-w-0 flex-1 space-y-1.5">
                <span className="flex items-baseline justify-between gap-3">
                  <span
                    className={cn('truncate text-sm', row.readAt ? 'font-medium' : 'font-semibold')}
                  >
                    <bdi>{row.title}</bdi>
                  </span>
                  <Ago
                    at={row.publishedAt ?? row.createdAt}
                    className="shrink-0 text-xs text-fg-3"
                  />
                </span>
                <span className="line-clamp-2 block text-sm text-fg-3">
                  <bdi>{row.body}</bdi>
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-xs text-fg-3">
                    <bdi>{row.author.fullName}</bdi>
                  </span>
                  <AudienceChips row={row} {...lookups} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {meta && meta.total > rows.length && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => setSize((value) => value + PAGE)}>
            {tp('announcements.loadMore', { shown: rows.length, total: meta.total })}
          </Button>
        </div>
      )}
      {opened && (
        <Modal drawer title={tp('announcements.panel')} onClose={() => setFilter('open', null)}>
          <AnnouncementBody id={opened} />
        </Modal>
      )}
      {compose && <Compose close={() => setCompose(false)} />}
    </>
  );
}
