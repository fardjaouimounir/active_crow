import { loginBodySchema } from '@fieldflow/shared';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../../shared/ui/TextField.jsx';
import { useLoginMutation } from '../api.js';
import { AuthCard } from '../components/AuthCard.jsx';
import { apiErrorMessage } from '../errorMessage.js';

/** @param {Record<string, string>} values @param {import('zod').ZodError} error */
function fieldErrorsFrom(values, error) {
  const errors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (errors[field]) continue;
    const filled = values[field].trim() !== '';
    errors[field] = field === 'email' && filled ? 'validation.emailInvalid' : 'validation.required';
  }
  return errors;
}

/** FR-001: email + password. After success the route guard sends the user to their surface. */
export function LoginPage() {
  const { t } = useTranslation(['auth', 'common']);
  const login = useLoginMutation();
  const [values, setValues] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});

  const update = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
  };

  const onSubmit = (event) => {
    event.preventDefault();
    const parsed = loginBodySchema.safeParse(values);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFrom(values, parsed.error));
      return;
    }
    setFieldErrors({});
    login.mutate(parsed.data);
  };

  return (
    <AuthCard title={t('login.title')} subtitle={t('login.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {login.isError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-900"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-600" />
            <span>{apiErrorMessage(t, login.error)}</span>
          </div>
        )}
        <TextField
          label={t('login.email')}
          type="email"
          name="email"
          autoComplete="username"
          dir="ltr"
          value={values.email}
          onChange={update('email')}
          error={fieldErrors.email && t(fieldErrors.email)}
          disabled={login.isPending}
        />
        <TextField
          label={t('login.password')}
          type="password"
          name="password"
          autoComplete="current-password"
          dir="ltr"
          value={values.password}
          onChange={update('password')}
          error={fieldErrors.password && t(fieldErrors.password)}
          disabled={login.isPending}
        />
        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-lg bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {login.isPending ? t('login.submitting') : t('login.submit')}
        </button>
      </form>
    </AuthCard>
  );
}
