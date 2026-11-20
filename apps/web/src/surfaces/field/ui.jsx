import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOutletContext } from 'react-router';
import { resizeFieldImage } from './image.js';

export const card = 'grid gap-3 rounded-xl border border-line-strong bg-surface p-4';
/** Spring is reserved for the one primary action on a field screen. */
export const primary =
  'inline-flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-fg bg-accent px-5 py-2 text-lg font-bold text-accent-fg active:brightness-95 disabled:opacity-60';
export const secondary =
  'inline-flex min-h-14 items-center justify-center gap-2 rounded-lg border-2 border-control bg-surface px-4 py-2 text-base font-semibold text-fg active:bg-sunken disabled:opacity-60';
export const control =
  'min-h-14 w-full rounded-lg border-2 border-control bg-surface px-3 py-2 text-base text-fg';
export const useField = () => useOutletContext();
export const fieldTime = (value, locale) =>
  new Intl.DateTimeFormat(locale, {
    timeZone: 'Africa/Algiers',
    numberingSystem: 'latn',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

export function ErrorMessage({ code }) {
  const { t } = useTranslation(['field', 'common']);
  if (!code) return null;
  const message = t('errors.codes.' + code, {
    ns: 'common',
    defaultValue: t('errors.' + code, {
      defaultValue: t('errors.INTERNAL_ERROR', { ns: 'field' }),
    }),
  });
  return (
    <p
      role="alert"
      className="rounded-lg border-2 border-danger-line bg-danger-soft p-3 font-medium text-danger"
    >
      {message}
    </p>
  );
}

export function QueryState({ query }) {
  const { t } = useTranslation('field');
  if (query.isPending) return <p role="status">{t('loading')}</p>;
  if (query.isError)
    return (
      <div className="grid gap-2">
        <ErrorMessage code={query.error?.code ?? 'NETWORK_ERROR'} />
        <button className={secondary} onClick={() => query.refetch()}>
          {t('refresh')}
        </button>
      </div>
    );
  return null;
}

export function Availability({ query, field, next }) {
  const { t } = useTranslation('field');
  return (
    <div className={card}>
      <QueryState query={query} />
      {query.isSuccess && (
        <p>{field?.closedReason ? t('closed.' + field.closedReason) : t('noAssignment')}</p>
      )}
      {!field && next && <p>{t('nextAssignment', { date: next })}</p>}
    </div>
  );
}

export function Stepper({ name, value, min = 0, max = 1000, onChange }) {
  const { t } = useTranslation('field');
  return (
    <div className="flex flex-none items-center gap-2">
      <button
        type="button"
        className={secondary + ' size-14 px-0'}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
        aria-label={t('decrease', { name })}
      >
        −
      </button>
      <output className="min-w-6 text-center tabular-nums" dir="ltr" aria-label={name}>
        {value}
      </output>
      <button
        type="button"
        className={secondary + ' size-14 px-0'}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={t('increase', { name })}
      >
        +
      </button>
    </div>
  );
}

export function PhotoPicker({ file, onChange, required = false, onProcessing, recover = false }) {
  const { t } = useTranslation('field');
  const [state, setState] = useState(null);
  const preview = useRef(null);
  const selection = useRef(0);
  async function select(event) {
    const image = event.target.files?.[0];
    if (!image) return;
    const selected = ++selection.current;
    setState('loading');
    onProcessing?.(true);
    onChange(null);
    try {
      const processed = recover ? image : await resizeFieldImage(image);
      if (selected === selection.current) {
        onChange(processed);
        setState(null);
      }
    } catch {
      if (selected === selection.current) setState('camera');
    } finally {
      if (selected === selection.current) onProcessing?.(false);
    }
  }
  useEffect(() => {
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    preview.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <div className="grid gap-2">
      <label className="grid gap-2 font-medium">
        {t('photo')}
        {required ? ' *' : ''}
        <input
          className={control + ' file:me-3 file:rounded file:border-0 file:bg-sunken file:p-2'}
          type="file"
          accept="image/*"
          capture={recover ? undefined : 'environment'}
          onChange={select}
        />
      </label>
      {state === 'loading' && <p role="status">{t('processingPhoto')}</p>}
      {state === 'camera' && <ErrorMessage code="CAMERA_PERMISSION" />}
      {file && (
        <img ref={preview} className="max-h-48 rounded-xl object-contain" alt={t('preview')} />
      )}
      <details>
        <summary className="min-h-12 cursor-pointer py-3">{t('cameraHelp')}</summary>
        <p>{t('errors.CAMERA_PERMISSION')}</p>
      </details>
    </div>
  );
}

export function PendingSubmission({ write, children }) {
  const { t } = useTranslation('field');
  const [newFile, setNewFile] = useState(null);
  return (
    <>
      {write.problem && <ErrorMessage code={write.problem} />}
      {write.pending && !write.busy && (
        <section className={card + ' border-warning-line bg-warning-soft'} aria-label={t('unsent')}>
          <p className="font-semibold">{t('unsent')}</p>
          {children}
          {write.needsAttachment && (
            <PhotoPicker file={newFile} onChange={setNewFile} required recover />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => write.retry(newFile)}>
              {t('retry')}
            </button>
            <button type="button" className={secondary} onClick={write.discard}>
              {t('discard')}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
