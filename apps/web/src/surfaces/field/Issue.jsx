import { issueCategories, issueCreate } from '@fieldflow/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useFieldQuery } from './api.js';
import {
  Availability,
  PendingSubmission,
  PhotoPicker,
  QueryState,
  card,
  control,
  primary,
  useField,
} from './ui.jsx';
import { useFieldSubmit } from './useFieldSubmit.js';

function IssueForm({ field, write }) {
  const { t } = useTranslation(['field', 'common']);
  const [file, setFile] = useState(null);
  const [processing, setProcessing] = useState(false);
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(issueCreate),
    defaultValues: write.pending?.body ?? {
      campaignId: field.campaignId,
      pointOfSaleId: field.pointOfSale.id,
      category: 'stock_shortage',
    },
  });
  return (
    <form
      className={card}
      onSubmit={handleSubmit((body) =>
        write.submit({ path: '/issues', body, file, fileField: 'files' }),
      )}
    >
      <fieldset className="grid gap-3" disabled={write.busy || Boolean(write.pending)}>
        <label className="grid gap-1">
          {t('category')}
          <select className={control} {...register('category')}>
            {issueCategories.map((category) => (
              <option key={category} value={category}>
                {t('issues.categories.' + category, { ns: 'common' })}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          {t('title')}
          <input
            className={control}
            required
            minLength={3}
            maxLength={120}
            {...register('title')}
          />
        </label>
        <label className="grid gap-1">
          {t('description')}
          <textarea className={control} maxLength={2000} {...register('description')} />
        </label>
        <label className="grid gap-1">
          {t('stockItem')}
          <select
            className={control}
            {...register('stockItemId', { setValueAs: (value) => value || undefined })}
          >
            <option value="">{t('none')}</option>
            {field.stockItems?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <PhotoPicker file={file} onChange={setFile} onProcessing={setProcessing} />
        <button className={primary} disabled={processing}>
          {t(write.busy ? 'sending' : 'submitIssue')}
        </button>
      </fieldset>
    </form>
  );
}

export function Issue() {
  const { t } = useTranslation(['field', 'common']);
  const { field, sale } = useField();
  const [saved, setSaved] = useState(0);
  const write = useFieldSubmit('issue', () => setSaved((previous) => previous + 1));
  const open = useFieldQuery('/issues', { status: 'open', pageSize: 100 });
  const inProgress = useFieldQuery('/issues', { status: 'in_progress', pageSize: 100 });
  const issues = [...(open.data?.data ?? []), ...(inProgress.data?.data ?? [])];
  return (
    <>
      <h1 className="text-2xl font-bold">{t('issue')}</h1>
      {saved > 0 && (
        <p role="status" className={card}>
          {t('issueRecorded')}
        </p>
      )}
      <PendingSubmission write={write} />
      {field && ['assigned', 'active', 'suspended'].includes(field.campaignStatus) ? (
        <IssueForm field={field} write={write} key={field.assignmentId + ':' + saved} />
      ) : (
        <Availability query={sale} field={field} next={sale.data?.data.nextAssignmentDate} />
      )}
      <section className={card}>
        <h2 className="font-bold">{t('myIssues')}</h2>
        <QueryState query={open} />
        <QueryState query={inProgress} />
        {open.isSuccess && inProgress.isSuccess && !issues.length && <p>{t('noIssues')}</p>}
        {issues.map((item) => (
          <div key={item.id} className="rounded-xl bg-slate-100 p-3">
            <p className="font-semibold">{item.title}</p>
            <p>{t('issues.status.' + item.status, { ns: 'common' })}</p>
          </div>
        ))}
      </section>
    </>
  );
}
