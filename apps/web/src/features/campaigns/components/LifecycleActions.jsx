import { Ellipsis } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FormField, TextInput } from '../../../shared/ui/FormControls.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { IconButton } from '../../../ui/controls.jsx';
import { Popover, Tooltip } from '../../../ui/overlays.jsx';
import { Button, buttonClass, cn } from '../../../ui/primitives.jsx';
import { useWilayas } from '../../organization/api.js';
import { areaOptions } from '../../organization/components/Fields.jsx';
import { useCampaignWrite, useReadiness } from '../api.js';
import { BlockerList } from './LifecyclePanel.jsx';

/** The forward step of each status: the one primary action of the page. */
export const PRIMARY_ACTION = {
  draft: 'plan',
  planning: 'mark-assigned',
  assigned: 'activate',
  active: 'complete',
  suspended: 'resume',
  completed: 'close',
};

/** What the director can do with the campaign now: one primary action, the rest in a "…" menu. */
export function LifecycleActions({ campaign, extra = [] }) {
  const { t, i18n } = useTranslation('common');
  const { t: tp } = useTranslation('pro');
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
  const primary = actions.find((item) => item.action === PRIMARY_ACTION[campaign.status]);
  const others = actions.filter((item) => item !== primary);
  const trimmed = reason.trim();
  const label = (item) => t('campaigns.lifecycle.actions.' + item.action);
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
  const blockersOfError = Array.isArray(mutation.error?.details?.blockers)
    ? mutation.error.details.blockers
    : [];
  const whyDisabled = (item) =>
    !canTransition
      ? t('campaigns.lifecycle.directorOnly')
      : item.allowed
        ? undefined
        : item.blockers.length
          ? tp('campaign.blockedBy', {
              reason: t('campaigns.blockers.' + item.blockers[0].code, {
                defaultValue: item.blockers[0].code,
                wilayas: (item.blockers[0].details?.wilayaIds ?? []).map(wilayaName).join(', '),
                startDate: item.blockers[0].details?.startDate ?? '',
                endDate: item.blockers[0].details?.endDate ?? '',
                count: item.blockers[0].details?.count ?? 0,
              }),
            })
          : t('campaigns.lifecycle.notReady');
  const destructive = action?.action === 'cancel';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary &&
        (primary.allowed && canTransition ? (
          <Button variant="primary" onClick={() => setAction(primary)}>
            {label(primary)}
          </Button>
        ) : (
          <Tooltip label={whyDisabled(primary)} side="bottom">
            <Button
              variant="primary"
              aria-disabled="true"
              className="cursor-not-allowed opacity-50"
              onClick={(event) => event.preventDefault()}
            >
              {label(primary)}
            </Button>
          </Tooltip>
        ))}
      <Popover
        align="end"
        label={tp('campaign.moreActions')}
        trigger={
          <IconButton label={tp('campaign.moreActions')}>
            <Ellipsis aria-hidden="true" size={18} strokeWidth={1.5} />
          </IconButton>
        }
      >
        {({ close: closeMenu }) => (
          <div className="grid gap-0.5">
            {extra.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={closeMenu}
                className={cn(buttonClass({ variant: 'ghost', size: 'sm' }), 'justify-start')}
              >
                {item.label}
              </Link>
            ))}
            {others.map((item) => {
              const why = whyDisabled(item);
              const enabled = item.allowed && canTransition;
              return (
                <Tooltip key={item.action} label={enabled ? label(item) : why} side="bottom">
                  <button
                    type="button"
                    aria-disabled={!enabled}
                    onClick={() => {
                      if (!enabled) return;
                      closeMenu();
                      setAction(item);
                    }}
                    className={cn(
                      buttonClass({ variant: 'ghost', size: 'sm' }),
                      'w-full justify-start',
                    )}
                  >
                    {label(item)}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </Popover>
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
              <Button
                type="submit"
                variant={destructive ? 'danger' : 'primary'}
                disabled={trimmed.length < 3 || mutation.isPending}
              >
                {t('admin.confirm')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {action && !action.reasonRequired && (
        <ConfirmDialog
          title={label(action)}
          message={t('campaigns.lifecycle.confirm', { action: label(action) })}
          pending={mutation.isPending}
          tone={destructive ? 'danger' : 'primary'}
          onClose={close}
          onConfirm={run}
        >
          <Toast error message={message} />
          {blockersOfError.length > 0 && (
            <BlockerList blockers={blockersOfError} wilayaName={wilayaName} />
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
