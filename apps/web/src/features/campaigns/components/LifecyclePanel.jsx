import { LIFECYCLE_STEPS } from '@fieldflow/shared';
import { CircleX } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FormField, TextInput } from '../../../shared/ui/FormControls.jsx';
import { StatusBadge, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { Stepper } from '../../../ui/data.jsx';
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

/** Lifecycle position for the campaign header: planning → … → closed, with suspended / cancelled notes. */
export function LifecycleStepper({ status }) {
  const { t } = useTranslation('common');
  const cancelled = status === 'cancelled';
  return (
    <div className="grid gap-2">
      <Stepper
        label={t('campaigns.lifecycle.title')}
        steps={LIFECYCLE_STEPS.map((step) => ({ key: step, label: t('campaigns.status.' + step) }))}
        current={cancelled ? null : status === 'suspended' ? 'active' : status}
      />
      {status === 'suspended' && (
        <StatusBadge tone="warn">{t('campaigns.lifecycle.suspendedNote')}</StatusBadge>
      )}
      {cancelled && (
        <p role="status" className="flex items-center gap-2 text-sm text-danger">
          <CircleX aria-hidden="true" size={16} />
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
    <ul className="space-y-1.5 text-sm">
      {blockers.map((blocker, index) => {
        const details = blocker.details ?? {};
        const tab = FIX_TAB[blocker.code];
        return (
          <li key={blocker.code + index} className="flex items-start gap-2">
            <CircleX aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-danger" />
            <span>
              {t('campaigns.blockers.' + blocker.code, {
                defaultValue: blocker.code,
                wilayas: (details.wilayaIds ?? []).map(wilayaName).join(', '),
                startDate: details.startDate ? day(details.startDate) : '',
                endDate: details.endDate ? day(details.endDate) : '',
                count: details.count ?? 0,
              })}{' '}
              {tab && (
                <Link
                  className="text-accent-text underline underline-offset-4"
                  to={{ search: '?tab=' + tab }}
                >
                  {t('campaigns.lifecycle.fixIn', { tab: t('campaigns.tabs.' + tab) })}
                </Link>
              )}
            </span>
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
    <section className="grid gap-3 rounded-lg border border-line bg-surface p-4">
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
              className={item.action === 'cancel' ? actionStyle + ' text-danger' : primaryStyle}
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
            <p className="text-xs text-fg-2">{t('campaigns.lifecycle.reasonHint')}</p>
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
