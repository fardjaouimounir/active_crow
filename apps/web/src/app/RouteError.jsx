import { INTERNAL_ERROR, NOT_FOUND } from '@fieldflow/shared';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { ErrorState } from '../shared/ui/ErrorState.jsx';

/** Router-level error boundary: unknown URLs and errors thrown while rendering a route. */
export function RouteError() {
  const error = useRouteError();
  const { t } = useTranslation('common');
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <main className="mx-auto max-w-xl p-6">
      <ErrorState
        title={notFound ? t('errors.pageNotFound') : t('errors.unexpected')}
        message={t(`errors.codes.${notFound ? NOT_FOUND : INTERNAL_ERROR}`)}
      />
    </main>
  );
}
