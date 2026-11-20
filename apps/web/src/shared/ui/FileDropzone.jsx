import { checkUpload, FILE_KIND_RULES } from '@fieldflow/shared';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Drag & drop or browse for one file. Checks type and size against the shared rules of `kind`
 * before handing the file to `onFile` (the server still sniffs the content).
 * @param {{ kind: string, onFile: (file: File | null) => void, disabled?: boolean, file?: File | null }} props
 */
export function FileDropzone({ kind, onFile, disabled = false, file = null }) {
  const { t, i18n } = useTranslation('common');
  const input = useRef(null);
  const hint = useId();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState(null);
  const rules = FILE_KIND_RULES[kind];
  const accept = rules.flatMap((rule) => rule.mimeTypes).join(',');
  const megabytes = new Intl.NumberFormat(i18n.resolvedLanguage, {
    style: 'unit',
    unit: 'megabyte',
    maximumFractionDigits: 0,
  });

  const choose = (candidate) => {
    if (!candidate) return;
    const problem = checkUpload(kind, candidate);
    setError(problem);
    onFile(problem ? null : candidate);
  };

  return (
    <div className="grid gap-2">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) choose(event.dataTransfer.files[0]);
        }}
        className={
          'grid justify-items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm ' +
          (dragging ? 'border-slate-900 bg-slate-100' : 'border-slate-300 bg-white')
        }
      >
        <p>{file ? <bdi>{file.name}</bdi> : t('files.dropHere')}</p>
        <button
          type="button"
          disabled={disabled}
          aria-describedby={hint}
          onClick={() => input.current?.click()}
          className="rounded-lg border border-slate-300 px-3 py-2 font-medium hover:bg-slate-100 disabled:opacity-50"
        >
          {t('files.browse')}
        </button>
        <input
          ref={input}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          aria-label={t('files.browse')}
          disabled={disabled}
          onChange={(event) => {
            choose(event.target.files[0]);
            event.target.value = '';
          }}
        />
        <p id={hint} className="text-xs text-slate-600">
          {rules
            .map(
              (rule) =>
                rule.mimeTypes.map((type) => type.split('/')[1].toUpperCase()).join('/') +
                ' ≤ ' +
                megabytes.format(rule.maxBytes / (1024 * 1024)),
            )
            .join(' · ')}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t('errors.codes.' + error)}
        </p>
      )}
    </div>
  );
}
