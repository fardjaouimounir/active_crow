import { REQUIRED_RULE_TYPES, RULE_TYPES } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCan } from '../../../shared/auth/hooks.js';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { useFilters } from '../../../shared/ui/FilterBar.jsx';
import { Select } from '../../../shared/ui/FormControls.jsx';
import { EmptyState, StatusBadge, Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { actionStyle, primaryStyle } from '../../organization/components/Fields.jsx';
import { useCampaignWrite, useClientStockItems, useRuleSet, useRuleSets } from '../api.js';
import { PromotionPreview } from './PromotionPreview.jsx';
import { PromotionsEditor } from './PromotionsEditor.jsx';
import { RuleForm } from './RuleForms.jsx';

const STATUS_TONES = { draft: 'warn', approved: 'good', superseded: 'neutral' };

function RuleSection({ type, config, editable, ...form }) {
  const { t } = useTranslation('common');
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const required = REQUIRED_RULE_TYPES.includes(type);
  const configured = config !== undefined;
  if (!configured && !editable) return null;
  const path = `/campaigns/${form.campaignId}/rule-sets/${form.ruleSetId}/rules/${type}`;
  return (
    <section className="grid gap-3 rounded-xl border border-line bg-surface p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{t('rules.types.' + type)}</h3>
          {required && <StatusBadge tone="warn">{t('rules.required')}</StatusBadge>}
          <StatusBadge tone={configured ? 'good' : 'neutral'}>
            {t(configured ? 'rules.saved' : 'rules.notConfigured')}
          </StatusBadge>
        </div>
        {editable && configured && !required && (
          <button type="button" className={actionStyle} onClick={() => setRemoving(true)}>
            {t('rules.removeRule')}
          </button>
        )}
      </header>
      {configured || open ? (
        <RuleForm
          key={form.ruleSetId + type + configured}
          type={type}
          config={config}
          readOnly={!editable}
          onSaved={() => setOpen(false)}
          {...form}
        />
      ) : (
        <div>
          <button type="button" className={actionStyle} onClick={() => setOpen(true)}>
            {t('rules.configure')}
          </button>
        </div>
      )}
      {removing && (
        <ConfirmDialog
          title={t('rules.removeRule')}
          message={t('rules.confirmRemoveRule', { type: t('rules.types.' + type) })}
          pending={mutation.isPending}
          onClose={() => {
            setRemoving(false);
            mutation.reset();
          }}
          onConfirm={() =>
            mutation.mutate({ method: 'delete', path }, { onSuccess: () => setRemoving(false) })
          }
        >
          <Toast error message={message} />
        </ConfirmDialog>
      )}
    </section>
  );
}

/** What approval will freeze, what blocks it, and the server's verdict if it still refuses. */
function ApproveDialog({ campaign, ruleSet, onClose }) {
  const { t } = useTranslation('common');
  const mutation = useCampaignWrite();
  const { message } = useApiError(mutation.error);
  const missing = REQUIRED_RULE_TYPES.filter((type) => !Object.hasOwn(ruleSet.rules, type));
  const details = mutation.error?.details;
  const issues = Array.isArray(details?.issues) ? details.issues : [];
  const serverMissing = Array.isArray(details?.missing) ? details.missing : [];
  return (
    <Modal title={t('rules.approve.title', { version: ruleSet.version })} onClose={onClose}>
      <div className="grid gap-3 text-sm">
        <p>{t('rules.approve.intro')}</p>
        <ul className="list-disc ps-5">
          <li>
            {t('rules.approve.rules')}:{' '}
            {Object.keys(ruleSet.rules)
              .map((type) => t('rules.types.' + type))
              .join(', ') || '—'}
          </li>
          <li>{t('rules.approve.promotions', { count: ruleSet.promotions.length })}</li>
        </ul>
        {missing.length > 0 && (
          <p role="alert" className="text-danger">
            {t('rules.approve.missing', {
              types: missing.map((type) => t('rules.types.' + type)).join(', '),
            })}
          </p>
        )}
        {serverMissing.length > 0 && missing.length === 0 && (
          <p role="alert" className="text-danger">
            {t('rules.approve.missing', {
              types: serverMissing.map((type) => t('rules.types.' + type)).join(', '),
            })}
          </p>
        )}
        {issues.length > 0 && (
          <ul role="alert" className="list-disc ps-5 text-danger">
            {issues.map((issue, index) => (
              <li key={index}>
                {issue.ruleType ? t('rules.types.' + issue.ruleType) : t('rules.promotions.title')}:{' '}
                {issue.code
                  ? t('errors.codes.' + issue.code, { defaultValue: issue.message })
                  : issue.message}{' '}
                <bdi dir="ltr">({issue.path})</bdi>
              </li>
            ))}
          </ul>
        )}
        {message && issues.length === 0 && serverMissing.length === 0 && (
          <Toast error message={message} />
        )}
        <div className="flex justify-end gap-3">
          <button type="button" className={actionStyle} onClick={onClose}>
            {t('admin.cancel')}
          </button>
          <button
            type="button"
            className={primaryStyle}
            disabled={missing.length > 0 || mutation.isPending}
            onClick={() =>
              mutation.mutate(
                {
                  method: 'post',
                  path: `/campaigns/${campaign.id}/rule-sets/${ruleSet.id}/approve`,
                },
                { onSuccess: onClose },
              )
            }
          >
            {t('rules.approve.confirm')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** FR-033/034: versions of the campaign rules and promotions; the draft is edited, the rest read. */
export function RulesTab({ campaign, canEdit }) {
  const { t, i18n } = useTranslation('common');
  const canApprove = useCan('campaign.rules.approve');
  const { filters, setFilter } = useFilters();
  const list = useRuleSets(campaign.id);
  const mutation = useCampaignWrite();
  const listError = useApiError(list.error);
  const actionError = useApiError(mutation.error);
  const gifts = useClientStockItems(campaign.client.id, 'gift');
  const samples = useClientStockItems(campaign.client.id, 'sample');
  const [dialog, setDialog] = useState(null);
  const versions = list.data?.data ?? [];
  const hasDraft = versions.some((version) => version.status === 'draft');
  const selected =
    versions.find((version) => version.id === filters.rs) ??
    versions.find((version) => version.status === 'draft') ??
    versions[0];
  const detail = useRuleSet(campaign.id, selected?.id);
  const detailError = useApiError(detail.error);
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone: 'Africa/Algiers',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const stamp = (version) =>
    version.effectiveFrom ? ' · ' + date.format(new Date(version.effectiveFrom)) : '';
  const close = () => {
    setDialog(null);
    mutation.reset();
  };

  if (list.isPending) return <p role="status">{t('admin.loading')}</p>;
  if (list.isError) return <Toast error message={listError.message} />;
  if (!selected) return <EmptyState />;
  const ruleSet = detail.data?.data;
  const editable = canEdit && selected.status === 'draft';
  const products = campaign.products.map(({ id, name, sku }) => ({
    value: id,
    label: name + ' (' + sku + ')',
  }));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{t('rules.version')}</span>
          <Select value={selected.id} onChange={(event) => setFilter('rs', event.target.value)}>
            {versions.map((version) => (
              <option key={version.id} value={version.id}>
                {t('rules.versionOption', {
                  version: version.version,
                  status: t('rules.status.' + version.status),
                })}
                {stamp(version)}
              </option>
            ))}
          </Select>
        </label>
        <StatusBadge tone={STATUS_TONES[selected.status]}>
          {t('rules.status.' + selected.status)}
        </StatusBadge>
        {selected.approvedBy && (
          <span className="text-sm text-fg-2">
            {t('rules.approvedBy', {
              name: selected.approvedBy.fullName,
              date: date.format(new Date(selected.approvedAt)),
            })}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {editable && canApprove && ruleSet && (
          <button type="button" className={primaryStyle} onClick={() => setDialog('approve')}>
            {t('rules.approve.button')}
          </button>
        )}
        {canEdit && selected.status !== 'draft' && !hasDraft && (
          <button type="button" className={primaryStyle} onClick={() => setDialog('newVersion')}>
            {t('rules.newVersion')}
          </button>
        )}
        {editable && selected.version > 1 && (
          <button type="button" className={actionStyle} onClick={() => setDialog('discard')}>
            {t('rules.discard')}
          </button>
        )}
      </div>
      {!actionError.message || dialog ? null : <Toast error message={actionError.message} />}
      {selected.status !== 'draft' && (
        <p className="text-sm text-fg-2">{t('rules.readOnlyApproved')}</p>
      )}

      {detail.isPending && <p role="status">{t('admin.loading')}</p>}
      {detail.isError && <Toast error message={detailError.message} />}
      {ruleSet && (
        <>
          {RULE_TYPES.map((type) => (
            <RuleSection
              key={ruleSet.id + type}
              type={type}
              config={ruleSet.rules[type]}
              editable={editable}
              campaignId={campaign.id}
              ruleSetId={ruleSet.id}
              products={products}
              samples={samples.options}
            />
          ))}
          <section className="grid gap-3">
            <h3 className="font-semibold">{t('rules.promotions.title')}</h3>
            {ruleSet.promotions.length === 0 && !editable ? (
              <EmptyState message={t('rules.promotions.none')} />
            ) : (
              <PromotionsEditor
                key={ruleSet.id + ruleSet.promotions.map((promotion) => promotion.id).join()}
                campaignId={campaign.id}
                ruleSetId={ruleSet.id}
                promotions={ruleSet.promotions}
                products={products}
                gifts={gifts.options}
                readOnly={!editable}
              />
            )}
          </section>
          <PromotionPreview
            promotions={ruleSet.promotions}
            products={campaign.products}
            gifts={gifts.options}
          />
        </>
      )}

      {dialog === 'approve' && ruleSet && (
        <ApproveDialog campaign={campaign} ruleSet={ruleSet} onClose={close} />
      )}
      {dialog === 'newVersion' && (
        <ConfirmDialog
          title={t('rules.newVersion')}
          message={t('rules.confirmNewVersion', { version: selected.version })}
          pending={mutation.isPending}
          onClose={close}
          onConfirm={() =>
            mutation.mutate(
              { method: 'post', path: `/campaigns/${campaign.id}/rule-sets` },
              {
                onSuccess: (created) => {
                  close();
                  setFilter('rs', created.id);
                },
              },
            )
          }
        >
          <Toast error message={actionError.message} />
        </ConfirmDialog>
      )}
      {dialog === 'discard' && (
        <ConfirmDialog
          title={t('rules.discard')}
          message={t('rules.confirmDiscard', { version: selected.version })}
          pending={mutation.isPending}
          onClose={close}
          onConfirm={() =>
            mutation.mutate(
              { method: 'delete', path: `/campaigns/${campaign.id}/rule-sets/${selected.id}` },
              {
                onSuccess: () => {
                  close();
                  setFilter('rs', '');
                },
              },
            )
          }
        >
          <Toast error message={actionError.message} />
        </ConfirmDialog>
      )}
    </div>
  );
}
