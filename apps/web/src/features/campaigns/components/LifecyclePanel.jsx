import { LIFECYCLE_STEPS } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FormField, TextInput } from '../../../shared/ui/FormControls.jsx';
import { StatusBadge, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useWilayas } from '../../organization/api.js';
import { actionStyle, areaOptions, primaryStyle } from '../../organization/components/Fields.jsx';
import { useCampaignWrite, useReadiness } from '../api.js';

/** The tab where a blocker can be fixed (no link when it is fixed elsewhere or by time). */
const FIX_TAB = {
  NO_WILAYA_WITH_NEED: 'coverage',
  NO_PRODUCT: 'products',
  NO_APPROVED_RULE_SET: 'rules',
  NO_POINT_OF_SALE: 'pointsOfSale',
  WILAYA_WITHOUT_SUPERVISOR: 'coverage',
  WILAYA_WITHOUT_REGIONAL: 'coverage',
  BEFORE_START_DATE: 'overview',
  AFTER_END_DATE: 'overview',
};

function Stepper({ status }) {
  const { t } = useTranslation('common');
  const cancelled = status === 'cancelled';
  const current = LIFECYCLE_STEPS.indexOf(status === 'suspended' ? 'active' : status);
  return (
    <div className="grid gap-2">
      <ol aria-label={t('campaigns.lifecycle.title')} className="flex flex-wrap gap-2 text-sm">
        {LIFECYCLE_STEPS.map((step, index) => {
          const done = !cancelled && index < current;
          const here = !cancelled && index === current;
          return (
            <li
              key={step}
              aria-current={here ? 'step' : undefined}
              className={
                'rounded-full border px-3 py-1 ' +
                (here
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : done
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900'
                    : 'border-slate-200 text-slate-500')
              }
            >
              {t('campaigns.status.' + step)}
            </li>
          );
        })}
      </ol>
      {status === 'suspended' && (
        <StatusBadge tone="warn">{t('campaigns.lifecycle.suspendedNote')}</StatusBadge>
      )}
      {cancelled && (
        <p role="status" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {t('campaigns.lifecycle.cancelledNote')}
        </p>
      )}
    </div>
  );
}

export function BlockerList({ blockers, wilayaName }) {
  const { t, i18n } = useTranslation('common');
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone: 'UTC',
    dateStyle: 'medium',
  });
  const day = (iso) => date.format(new Date(iso + 'T00:00:00Z'));
  return (
    <ul className="list-disc ps-5 text-sm">
      {blockers.map((blocker, index) => {
        const details = blocker.details ?? {};
        const tab = FIX_TAB[blocker.code];
        return (
          <li key={blocker.code + index}>
            {t('campaigns.blockers.' + blocker.code, {
              defaultValue: blocker.code,
              wilayas: (details.wilayaIds ?? []).map(wilayaName).join(', '),
              startDate: details.startDate ? day(details.startDate) : '',
              endDate: details.endDate ? day(details.endDate) : '',
              count: details.count ?? 0,
            })}{' '}
            {tab && (
              <Link className="underline" to={{ search: '?tab=' + tab }}>
                {t('campaigns.lifecycle.fixIn', { tab: t('campaigns.tabs.' + tab) })}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Status stepper, the actions the campaign can take now, and what blocks the others. */
export function LifecyclePanel({ campaign }) {
  const { t, i18n } = useTranslation('common');
  const canTransition = useCan('campaign.transition');
  const readiness = useReadiness(campaign.id);
  const wilayas = useWilayas();
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const wilayaLabels = areaOptions(wilayas.data?.data, i18n.resolvedLanguage);
  const wilayaName = (id) => wilayaLabels.find((item) => item.value === id)?.label ?? id;
  const actions = readiness.data?.data.actions ?? [];
  const blocked = actions.filter((item) => !item.allowed);
  const trimmed = reason.trim();
  const close = () => {
    setAction(null);
    setReason('');
    mutation.reset();
  };
  const run = () =>
    mutation.mutate(
      {
        method: 'post',
        path: `/campaigns/${campaign.id}/${action.action}`,
        body: trimmed ? { reason: trimmed } : {},
      },
      { onSuccess: close },
    );
  const label = (item) => t('campaigns.lifecycle.actions.' + item.action);
  const blockersOfError = Array.isArray(mutation.error?.details?.blockers)
    ? mutation.error.details.blockers
    : [];

  return (
    <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-5">
      <Stepper status={campaign.status} />
      {actions.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={t('campaigns.lifecycle.actionsTitle')}
        >
          {actions.map((item) => (
            <button
              key={item.action}
              type="button"
              className={item.action === 'cancel' ? actionStyle + ' text-red-700' : primaryStyle}
              disabled={!item.allowed || !canTransition}
              title={
                !canTransition
                  ? t('campaigns.lifecycle.directorOnly')
                  : item.allowed
                    ? undefined
                    : t('campaigns.lifecycle.notReady')
              }
              onClick={() => setAction(item)}
            >
              {label(item)}
            </button>
          ))}
        </div>
      )}
      {blocked.length > 0 && (
        <div
          className="grid gap-3"
          aria-label={t('campaigns.lifecycle.blockersTitle')}
          role="region"
        >
          {blocked.map((item) => (
            <div key={item.action}>
              <h3 className="text-sm font-medium">
                {t('campaigns.lifecycle.toDo', { action: label(item) })}
              </h3>
              <BlockerList blockers={item.blockers} wilayaName={wilayaName} />
            </div>
          ))}
        </div>
      )}
      {action && action.reasonRequired && (
        <Modal title={label(action)} onClose={close}>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              run();
            }}
          >
            <FormField label={t('campaigns.lifecycle.reason')}>
              {(input) => (
                <TextInput
                  {...input}
                  value={reason}
                  maxLength={500}
                  required
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </FormField>
            <p className="text-xs text-slate-600">{t('campaigns.lifecycle.reasonHint')}</p>
            <Toast error message={message} />
            {blockersOfError.length > 0 && (
              <BlockerList blockers={blockersOfError} wilayaName={wilayaName} />
            )}
            <div>
              <button className={primaryStyle} disabled={trimmed.length < 3 || mutation.isPending}>
                {t('admin.confirm')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {action && !action.reasonRequired && (
        <ConfirmDialog
          title={label(action)}
          message={t('campaigns.lifecycle.confirm', { action: label(action) })}
          pending={mutation.isPending}
          onClose={close}
          onConfirm={run}
        >
          <Toast error message={message} />
          {blockersOfError.length > 0 && (
            <BlockerList blockers={blockersOfError} wilayaName={wilayaName} />
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
