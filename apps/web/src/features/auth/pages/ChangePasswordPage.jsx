import {
  CURRENT_PASSWORD_INCORRECT,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  WEAK_PASSWORD,
  changePasswordFormSchema,
} from '@fieldflow/shared';
import { Check, CircleAlert, Circle } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { landingPathFor } from '../../../shared/auth/guards.jsx';
import { useAuth } from '../../../shared/auth/hooks.js';
import { TextField } from '../../../shared/ui/TextField.jsx';
import { buttonClass } from '../../../ui/primitives.jsx';
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
              className={`flex items-center gap-2 ${met ? 'text-success' : failed.includes(rule.id) ? 'text-danger' : ''}`}
            >
              <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              {t(`policy.${rule.id}`, RULE_PARAMS[rule.id])}
            </li>
          );
        })}
        {extra.map((id) => (
          <li key={id} data-rule={id} className="flex items-center gap-2 text-danger">
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
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(changePasswordFormSchema),
    criteriaMode: 'all',
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  });
  const newPasswordValue = useWatch({ control, name: 'newPassword' });
  const failedRules = [errors.newPassword?.types?.custom ?? []].flat();
  const onSubmit = handleSubmit(({ currentPassword, newPassword }) => {
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: (session) =>
          navigate(landingPathFor(session.user, params.get('next')), { replace: true }),
        onError: (error) => {
          const message = apiErrorMessage(t, error);
          if (error.code === CURRENT_PASSWORD_INCORRECT)
            setError('currentPassword', { type: 'server', message });
          else {
            setError('root.server', { message });
            if (error.code === WEAK_PASSWORD)
              setError('newPassword', {
                types: { custom: (error.details ?? []).map((detail) => detail.message) },
              });
          }
        },
      },
    );
  });

  const busy = change.isPending || logout.isPending;

  return (
    <AuthCard
      title={t('changePassword.title')}
      subtitle={
        user?.mustChangePassword ? t('changePassword.required') : t('changePassword.voluntary')
      }
    >
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {errors.root?.server?.message && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>{errors.root?.server?.message}</span>
          </div>
        )}
        <TextField
          label={t('changePassword.current')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          {...register('currentPassword')}
          error={
            errors.currentPassword &&
            (errors.currentPassword.type === 'server'
              ? errors.currentPassword.message
              : t('validation.required'))
          }
          disabled={busy}
        />
        <TextField
          label={t('changePassword.new')}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          maxLength={PASSWORD_MAX_LENGTH + 1}
          {...register('newPassword')}
          error={errors.newPassword?.message === 'required' ? t('validation.required') : undefined}
          hint={<PolicyHints value={newPasswordValue} failed={failedRules} />}
          disabled={busy}
        />
        <TextField
          label={t('changePassword.confirm')}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          {...register('confirm')}
          error={
            errors.confirm &&
            t(
              errors.confirm.message === 'confirmMismatch'
                ? 'validation.confirmMismatch'
                : 'validation.required',
            )
          }
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy}
          className={buttonClass({ variant: 'primary', size: 'lg', className: 'w-full' })}
        >
          {change.isPending ? t('changePassword.submitting') : t('changePassword.submit')}
        </button>
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={busy}
          className="w-full rounded-lg px-4 py-2 text-sm font-medium text-fg-2 hover:bg-sunken disabled:opacity-60"
        >
          {t('common:actions.logout')}
        </button>
      </form>
    </AuthCard>
  );
}
