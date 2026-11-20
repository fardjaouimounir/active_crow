import { INTERNAL_ERROR } from '@fieldflow/shared';
import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '../../../shared/i18n/index.js';
import { Card } from '../../../shared/ui/Card.jsx';
import { ErrorState } from '../../../shared/ui/ErrorState.jsx';
import { Spinner } from '../../../shared/ui/Spinner.jsx';
import { useHealthQuery } from '../api.js';

/** API status card: loading, healthy and error states. */
export function HealthCard() {
  const { t, i18n } = useTranslation(['system', 'common']);
  const { data, error, isPending, isError, refetch } = useHealthQuery();
  const locale = getIntlLocale(i18n.resolvedLanguage);

  let body;
  if (isPending) {
    body = <Spinner label={t('health.checking')} />;
  } else if (isError) {
    body = (
      <ErrorState
        title={t('health.unreachable')}
        message={t(`common:errors.codes.${error.code}`, {
          defaultValue: t(`common:errors.codes.${INTERNAL_ERROR}`),
        })}
        hint={error.requestId && t('common:errors.reference', { requestId: error.requestId })}
        onRetry={() => refetch()}
        retryLabel={t('common:actions.retry')}
      />
    );
  } else {
    const uptime = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'long',
    }).format(data.uptimeSeconds);

    body = (
      <div className="space-y-4">
        <p className="flex items-center gap-2 font-medium text-emerald-700">
          <CircleCheck aria-hidden="true" className="size-5 shrink-0" />
          {t('health.healthy')}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-slate-500">{t('health.version')}</dt>
          <dd className="font-mono" dir="ltr">
            {data.version}
          </dd>
          <dt className="text-slate-500">{t('health.uptime')}</dt>
          <dd>{uptime}</dd>
        </dl>
      </div>
    );
  }

  return <Card title={t('health.title')}>{body}</Card>;
}
