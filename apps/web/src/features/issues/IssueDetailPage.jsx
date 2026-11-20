import { issueAssign, issueChange, issueComment } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth, useCan } from '../../shared/auth/hooks.js';
import { Modal } from '../../shared/ui/Dialogs.jsx';
import { FormField, SearchSelect } from '../../shared/ui/FormControls.jsx';
import { EmptyState, PageHeader, StatusBadge, Toast } from '../../shared/ui/PageParts.jsx';
import { useApiError } from '../../shared/ui/useApiError.js';
import { useCommunication, useCommunicationWrite } from '../notifications/api.js';
import { useManagers } from '../organization/api.js';
import { actionStyle, primaryStyle } from '../organization/components/Fields.jsx';
import { AttachmentsInput, formBody } from './IssueForm.jsx';

const roles = ['director', 'general_manager', 'regional_manager', 'supervisor'];
const useOptions = (q) => useManagers(q, roles);
function Attachments({ files }) {
  const { t } = useTranslation('common');
  return (
    files.length > 0 && (
      <ul className="flex flex-wrap gap-2">
        {files.map(({ fileId }, index) => (
          <li key={fileId}>
            <Link className="underline text-sm" to={'/files/' + fileId}>
              {t('issues.attachment', { number: index + 1 })}
            </Link>
          </li>
        ))}
      </ul>
    )
  );
}
function IssueAction({ issue, action, close }) {
  const { t } = useTranslation('common');
  const mutation = useCommunicationWrite();
  const { message } = useApiError(mutation.error);
  const form = useForm({
    resolver: zodResolver(action === 'assign' ? issueAssign : issueChange),
    defaultValues: {
      version: issue.version,
      ...(action === 'assign' ? { assigneeId: issue.assignedToId ?? '' } : {}),
    },
  });
  const assignee = useWatch({ control: form.control, name: 'assigneeId' });
  const needsNote = action === 'resolve' || (action === 'close' && issue.status !== 'resolved');
  return (
    <Modal title={t('issues.actions.' + action)} onClose={close}>
      <form
        className="grid gap-3"
        onSubmit={form.handleSubmit((body) =>
          mutation.mutate(
            { path: '/issues/' + issue.id + '/' + action, body },
            { onSuccess: close },
          ),
        )}
      >
        {action === 'assign' && (
          <FormField
            label={t('issues.assignee')}
            error={form.formState.errors.assigneeId && t('admin.invalidField')}
          >
            {(props) => (
              <SearchSelect
                {...props}
                required
                useOptions={useOptions}
                value={assignee}
                onChange={(value) => form.setValue('assigneeId', value)}
              />
            )}
          </FormField>
        )}
        {needsNote && (
          <FormField label={t('issues.resolutionNote')}>
            {(props) => (
              <textarea
                {...props}
                {...form.register('resolutionNote')}
                required
                rows={3}
                className="rounded border p-2"
              />
            )}
          </FormField>
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
function Comments({ id }) {
  const { t, i18n } = useTranslation('common');
  const query = useCommunication('/issues/' + id + '/comments');
  const mutation = useCommunicationWrite();
  const { message } = useApiError(query.error ?? mutation.error);
  const [files, setFiles] = useState([]);
  const [formKey, setFormKey] = useState(0);
  const form = useForm({ resolver: zodResolver(issueComment), defaultValues: { body: '' } });
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <section className="grid gap-3 rounded-xl border bg-surface p-4">
      <h2 className="font-semibold">{t('issues.comments')}</h2>
      {query.isPending && <p role="status">{t('admin.loading')}</p>}
      {query.isSuccess && !query.data.data.length && <EmptyState />}
      <ol className="space-y-3">
        {(query.data?.data ?? []).map((row) => (
          <li key={row.id} className="border-s-2 ps-3">
            <strong>{row.author.fullName}</strong> ·{' '}
            <time dateTime={row.createdAt}>{date.format(new Date(row.createdAt))}</time>
            <p className="whitespace-pre-wrap break-words">{row.body}</p>
            <Attachments files={row.attachments} />
          </li>
        ))}
      </ol>
      <form
        key={formKey}
        className="grid gap-2"
        onSubmit={form.handleSubmit((body) =>
          mutation.mutate(
            { path: '/issues/' + id + '/comments', body: formBody(body, files) },
            {
              onSuccess: () => {
                form.reset();
                setFiles([]);
                setFormKey(formKey + 1);
              },
            },
          ),
        )}
      >
        <FormField
          label={t('issues.addComment')}
          error={form.formState.errors.body && t('admin.invalidField')}
        >
          {(props) => (
            <textarea
              {...props}
              {...form.register('body')}
              rows={3}
              className="rounded border p-2"
            />
          )}
        </FormField>
        <AttachmentsInput onChange={setFiles} />
        <Toast
          error
          message={files.length > 3 ? t('errors.codes.TOO_MANY_ATTACHMENTS') : message}
        />
        <div>
          <button className={primaryStyle} disabled={files.length > 3 || mutation.isPending}>
            {t('admin.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
export function IssueDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const manage = useCan('issue.manage');
  const query = useCommunication('/issues/' + id);
  const { message } = useApiError(query.error);
  const [action, setAction] = useState(null);
  if (query.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (message) return <Toast error message={message} />;
  const issue = query.data.data;
  const actions = [
    ...(manage ? (issue.status === 'closed' ? [] : ['assign']) : []),
    ...(manage && issue.status === 'open' ? ['start'] : []),
    ...(manage && issue.status === 'in_progress' ? ['resolve'] : []),
    ...(issue.status === 'resolved' && (manage || issue.reportedById === user.id)
      ? ['reopen']
      : []),
    ...(manage && issue.status !== 'closed' ? ['close'] : []),
  ];
  return (
    <div className="space-y-4">
      <PageHeader title={issue.title}>
        <Link className={actionStyle} to="/app/issues">
          {t('admin.back')}
        </Link>
      </PageHeader>
      <section className="grid gap-3 rounded-xl border bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge>{t('issues.status.' + issue.status)}</StatusBadge>
          <StatusBadge>{t('issues.categories.' + issue.category)}</StatusBadge>
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          {[
            ['admin.campaign', issue.campaign.name],
            ['admin.point', issue.pointOfSale?.name],
            ['issues.reporter', issue.reportedBy.fullName],
            ['issues.assignee', issue.assignedTo?.fullName],
          ].map(([key, value]) => (
            <div key={key}>
              <dt className="font-semibold">{t(key)}</dt>
              <dd>{value ?? '—'}</dd>
            </div>
          ))}
        </dl>
        <p className="whitespace-pre-wrap break-words">{issue.description}</p>
        {issue.resolutionNote && (
          <p className="whitespace-pre-wrap break-words">{issue.resolutionNote}</p>
        )}
        <Attachments files={issue.attachments} />
        <div className="flex flex-wrap gap-2">
          {actions.map((value) => (
            <button
              type="button"
              key={value}
              className={actionStyle}
              onClick={() => setAction(value)}
            >
              {t('issues.actions.' + value)}
            </button>
          ))}
        </div>
      </section>
      <Comments key={id} id={id} />
      {action && <IssueAction issue={issue} action={action} close={() => setAction(null)} />}
    </div>
  );
}
