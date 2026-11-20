import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useFileObjectUrl } from '../api.js';

/**
 * `/files/:id` for any signed-in user: loads the file with the session token and shows it full page
 * (PDF in the browser viewer, images as is). Unauthorised or unshared files answer "not found".
 */
export function FileViewerPage() {
  const { id } = useParams();
  const { t } = useTranslation('common');
  const file = useFileObjectUrl(id);
  const { message } = useApiError(file.error);
  if (file.error) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <Toast error message={message} />
      </main>
    );
  }
  if (!file.url) return <p role="status">{t('admin.loading')}</p>;
  return file.type?.startsWith('image/') ? (
    <main className="flex min-h-screen items-center justify-center bg-brand-black p-4">
      <img src={file.url} alt="" className="max-h-[95vh] max-w-full" />
    </main>
  ) : (
    <iframe title={t('campaigns.document')} src={file.url} className="h-screen w-full border-0" />
  );
}
