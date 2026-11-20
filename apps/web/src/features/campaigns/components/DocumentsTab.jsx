import { SHAREABLE_FILE_KINDS } from '@fieldflow/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCan } from '../../../shared/auth/hooks.js';
import { DataTable } from '../../../shared/ui/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../../shared/ui/Dialogs.jsx';
import { FileDropzone } from '../../../shared/ui/FileDropzone.jsx';
import { Toast } from '../../../shared/ui/PageParts.jsx';
import { useApiError } from '../../../shared/ui/useApiError.js';
import { useFileObjectUrl } from '../../files/api.js';
import { actionStyle, InputField, primaryStyle } from '../../organization/components/Fields.jsx';
import { useCampaignDocuments, useCampaignWrite, useDocumentUpload } from '../api.js';

const KIND = 'campaign_document';

function Thumbnail({ document }) {
  const { url } = useFileObjectUrl(
    document.hasThumbnail ? document.fileId : undefined,
    'thumbnail',
  );
  if (!document.hasThumbnail) return <span className="text-xs text-fg-3">PDF</span>;
  return url ? (
    <img src={url} alt="" className="h-10 w-10 rounded object-cover" />
  ) : (
    <span className="block h-10 w-10 animate-pulse rounded bg-sunken" />
  );
}

function UploadPanel({ campaignId }) {
  const { t } = useTranslation('common');
  const [file, setFile] = useState(null);
  const [label, setLabel] = useState('');
  const [progress, setProgress] = useState(0);
  const upload = useDocumentUpload(campaignId, setProgress);
  const { message } = useApiError(upload.error);
  const validLabel = label.trim().length > 0 && label.trim().length <= 120;
  return (
    <form
      className="grid gap-3 rounded-xl border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        setProgress(0);
        upload.mutate(
          { file, label: label.trim() },
          {
            onSuccess: () => {
              setFile(null);
              setLabel('');
            },
          },
        );
      }}
    >
      <FileDropzone kind={KIND} file={file} onFile={setFile} disabled={upload.isPending} />
      <InputField
        name="label"
        value={label}
        onChange={setLabel}
        maxLength={120}
        required
        disabled={upload.isPending}
      />
      {upload.isPending && (
        <progress className="w-full" max={100} value={progress} aria-label={t('files.progress')}>
          {progress}%
        </progress>
      )}
      <Toast error message={message} />
      <div>
        <button className={primaryStyle} disabled={!file || !validLabel || upload.isPending}>
          {t('files.upload')}
        </button>
      </div>
    </form>
  );
}

/** FR-032: reference documents (Mécanisme PDF, images), shared with the client explicitly. */
export function DocumentsTab({ campaign, canEdit }) {
  const { t, i18n } = useTranslation('common');
  const canShare = useCan('file.share_with_client') && SHAREABLE_FILE_KINDS.includes(KIND);
  const documents = useCampaignDocuments(campaign.id);
  const mutation = useCampaignWrite();
  const listError = useApiError(documents.error);
  const actionError = useApiError(mutation.error);
  const [dialog, setDialog] = useState(null);
  const [label, setLabel] = useState('');
  const bytes = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: 'unit',
    unit: 'kilobyte',
    maximumFractionDigits: 0,
  });
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    timeZone: 'Africa/Algiers',
    dateStyle: 'medium',
  });
  const close = () => {
    setDialog(null);
    mutation.reset();
  };
  const columns = [
    { id: 'preview', header: '', cell: ({ row }) => <Thumbnail document={row.original} /> },
    { accessorKey: 'label', header: t('admin.label') },
    {
      accessorKey: 'sizeBytes',
      header: t('files.size'),
      cell: ({ getValue }) => bytes.format(Math.max(1, Math.round(getValue() / 1024))),
    },
    {
      id: 'uploadedBy',
      header: t('files.uploadedBy'),
      cell: ({ row }) => row.original.uploadedBy?.fullName ?? '—',
    },
    {
      accessorKey: 'createdAt',
      header: t('admin.createdAt'),
      cell: ({ getValue }) => date.format(new Date(getValue())),
    },
    {
      id: 'actions',
      header: t('catalog.actions'),
      cell: ({ row }) => {
        const document = row.original;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Link
              className={actionStyle}
              to={'/files/' + document.fileId}
              target="_blank"
              rel="noopener"
            >
              {t('files.open')}
            </Link>
            {canShare && (
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={document.visibility === 'client_visible'}
                  disabled={mutation.isPending}
                  onChange={(event) =>
                    mutation.mutate({
                      method: 'patch',
                      path: '/files/' + document.fileId + '/visibility',
                      body: { visibility: event.target.checked ? 'client_visible' : 'internal' },
                    })
                  }
                />
                {t('files.shareWithClient')}
              </label>
            )}
            {canEdit &&
              ['rename', 'remove'].map((action) => (
                <button
                  key={action}
                  type="button"
                  className={actionStyle}
                  aria-label={t('campaigns.' + action) + ' ' + document.label}
                  onClick={() => {
                    setLabel(document.label ?? '');
                    setDialog({ action, document });
                  }}
                >
                  {t('campaigns.' + action)}
                </button>
              ))}
          </div>
        );
      },
    },
  ];
  const path = (document) => '/campaigns/' + campaign.id + '/documents/' + document.id;
  return (
    <div className="grid gap-4">
      {canEdit && <UploadPanel campaignId={campaign.id} />}
      {!dialog && <Toast error message={actionError.message} />}
      <DataTable
        columns={columns}
        rows={documents.data?.data ?? []}
        total={documents.data?.data?.length ?? 0}
        loading={documents.isPending}
        error={listError.message}
      />
      {dialog?.action === 'rename' && (
        <Modal title={t('campaigns.rename')} onClose={close}>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate(
                { method: 'patch', path: path(dialog.document), body: { label: label.trim() } },
                { onSuccess: close },
              );
            }}
          >
            <InputField name="label" value={label} onChange={setLabel} maxLength={120} required />
            <Toast error message={actionError.message} />
            <div>
              <button className={primaryStyle} disabled={!label.trim() || mutation.isPending}>
                {t('admin.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog?.action === 'remove' && (
        <ConfirmDialog
          title={t('campaigns.remove')}
          message={t('campaigns.confirmRemoveDocument', { name: dialog.document.label })}
          pending={mutation.isPending}
          onClose={close}
          onConfirm={() =>
            mutation.mutate({ method: 'delete', path: path(dialog.document) }, { onSuccess: close })
          }
        >
          <Toast error message={actionError.message} />
        </ConfirmDialog>
      )}
    </div>
  );
}
