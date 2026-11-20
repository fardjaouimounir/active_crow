import { loginBodySchema } from '@fieldflow/shared';
import { CircleAlert } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../../shared/ui/TextField.jsx';
import { buttonClass } from '../../../ui/primitives.jsx';
import { useLoginMutation } from '../api.js';
import { AuthCard } from '../components/AuthCard.jsx';
import { apiErrorMessage } from '../errorMessage.js';

/** FR-001: email + password. After success the route guard sends the user to their surface. */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const login = useLoginMutation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginBodySchema),
    defaultValues: { email: '', password: '' },
  });
  const onSubmit = handleSubmit((values) => login.mutate(values));

  return (
    <AuthCard title={t('login.title')} subtitle={t('login.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {login.isError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-danger-soft p-3 text-sm text-danger"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            <span>{apiErrorMessage(t, login.error)}</span>
          </div>
        )}
        <TextField
          label={t('login.email')}
          type="email"
          autoComplete="username"
          dir="ltr"
          {...register('email')}
          error={
            errors.email &&
            t(
              errors.email.message === 'required'
                ? 'validation.required'
                : 'validation.emailInvalid',
            )
          }
          disabled={login.isPending}
        />
        <TextField
          label={t('login.password')}
          type="password"
          autoComplete="current-password"
          dir="ltr"
          {...register('password')}
          error={errors.password && t('validation.required')}
          disabled={login.isPending}
        />
        <button
          type="submit"
          disabled={login.isPending}
          className={buttonClass({ variant: 'primary', size: 'lg', className: 'w-full' })}
        >
          {login.isPending ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </AuthCard>
  );
}
