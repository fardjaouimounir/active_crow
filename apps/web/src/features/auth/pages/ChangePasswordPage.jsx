import {
  CURRENT_PASSWORD_INCORRECT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  WEAK_PASSWORD,
  passwordPolicyViolations,
} from '@fieldflow/shared';
import { Check, CircleAlert, Circle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { landingPathFor } from '../../../shared/auth/guards.jsx';
import { useAuth } from '../../../shared/auth/hooks.js';
import { TextField } from '../../../shared/ui/TextField.jsx';
import { useChangePasswordMutation, useLogoutMutation } from '../api.js';
import { AuthCard } from '../components/AuthCard.jsx';
import { apiErrorMessage } from '../errorMessage.js';

const RULE_PARAMS = {
  min_length: { n: PASSWORD_MIN_LENGTH },
  max_length: { n: PASSWORD_MAX_LENGTH },
};
/** Rules shown as a live checklist (the max length is only reported when broken). */
const CHECKLIST = PASSWORD_RULES.filter((rule) => rule.id !== 'max_length');

/** The policy as a checklist that ticks as the user types; broken rules after submit in red. */
function PolicyHints({ value, failed }) {
  const { t } = useTranslation('auth');
  const extra = failed.filter((id) => !CHECKLIST.some((rule) => rule.id === id));
  return (
    <div>
      <p>{t('changePassword.policyTitle')}</p>
      <ul className="mt-1 space-y-0.5">
        {CHECKLIST.map((rule) => {
          const met = value.length > 0 && rule.test(value);
          const Icon = met ? Check : Circle;
          return (
            <li
              key={rule.id}
              data-rule={rule.id}
              data-met={met}
              className={`flex items-center gap-2 ${met ? 'text-emerald-700' : failed.includes(rule.id) ? 'text-red-700' : ''}`}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              {t(`policy.${rule.id}`, RULE_PARAMS[rule.id])}
            </li>
          );
        })}
        {extra.map((id) => (
          <li key={id} data-rule={id} className="flex items-center gap-2 text-red-700">
            <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {t(`policy.${id}`, RULE_PARAMS[id])}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * FR-002: shown (and enforced by the guards) while `mustChangePassword`; also reachable to change
 * the password voluntarily. Success replaces the session; other devices are signed out.
 */
export function ChangePasswordPage() {
  const { t } = useTranslation(['auth', 'common']);
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const change = useChangePasswordMutation();
  const logout = useLogoutMutation();
  const [values, setValues] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [failedRules, setFailedRules] = useState([]);

  const update = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  const onSubmit = (event) => {
    event.preventDefault();
    const { currentPassword, newPassword, confirm } = values;
    const next = {};
    if (!currentPassword) next.currentPassword = t('validation.required');
    const rules = passwordPolicyViolations(newPassword);
    if (newPassword && newPassword === currentPassword) rules.push('same_as_current');
    if (!newPassword) next.newPassword = t('validation.required');
    if (!confirm) next.confirm = t('validation.required');
    else if (confirm !== newPassword) next.confirm = t('validation.confirmMismatch');
    setFailedRules(rules);
    setErrors(next);
    if (Object.keys(next).length > 0 || rules.length > 0) return;

    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: (session) =>
          navigate(landingPathFor(session.user, params.get('next')), { replace: true }),
        onError: (error) => {
          if (error.code === CURRENT_PASSWORD_INCORRECT) {
            setErrors({ currentPassword: apiErrorMessage(t, error) });
          } else if (error.code === WEAK_PASSWORD) {
            setFailedRules((error.details ?? []).map((detail) => detail.message));
            setErrors({ form: apiErrorMessage(t, error) });
          } else {
            setErrors({ form: apiErrorMessage(t, error) });
          }
        },
      },
    );
  };

  const busy = change.isPending || logout.isPending;

  return (
    <AuthCard
      title={t('changePassword.title')}
      subtitle={
        user?.mustChangePassword ? t('changePassword.required') : t('changePassword.voluntary')
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {errors.form && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-600" />
            <span>{errors.form}</span>
          </div>
        )}
        <TextField
          label={t('changePassword.current')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={values.currentPassword}
          onChange={update('currentPassword')}
          error={errors.currentPassword}
          disabled={busy}
        />
        <TextField
          label={t('changePassword.new')}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          maxLength={PASSWORD_MAX_LENGTH + 1}
          value={values.newPassword}
          onChange={(event) => {
            update('newPassword')(event);
            setFailedRules([]);
          }}
          error={errors.newPassword}
          hint={<PolicyHints value={values.newPassword} failed={failedRules} />}
          disabled={busy}
        />
        <TextField
          label={t('changePassword.confirm')}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={values.confirm}
          onChange={update('confirm')}
          error={errors.confirm}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {change.isPending ? t('changePassword.submitting') : t('changePassword.submit')}
        </button>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={busy}
          className="w-full rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
        >
          {t('common:actions.logout')}
        </button>
      </form>
    </AuthCard>
  );
}
