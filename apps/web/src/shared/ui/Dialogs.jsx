import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/** Native modal with keyboard dismissal and focus restoration. */
export function Modal({ title, onClose, children, drawer = false }) {
  const dialog = useRef(null);
  const heading = useId();
  const { t } = useTranslation('common');
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={
        drawer
          ? 'm-0 ms-auto h-dvh max-h-none w-[min(32rem,100vw)] bg-white p-6 shadow-xl backdrop:bg-slate-900/50'
          : 'm-auto max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] rounded-xl bg-white p-6 shadow-xl backdrop:bg-slate-900/50'
      }
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id={heading} className="text-lg font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('admin.close')}
          className="px-2 text-lg"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** Confirms a destructive change before invoking the supplied action. */
export function ConfirmDialog({ title, message, pending, onClose, onConfirm, children }) {
  const { t } = useTranslation('common');
  return (
    <Modal title={title} onClose={pending ? () => {} : onClose}>
      <p className="mb-4 text-sm">{message}</p>
      {children}
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onClose} disabled={pending}>
          {t('admin.cancel')}
        </button>
        <button
          type="button"
          className="rounded-lg bg-red-700 px-3 py-2 text-white disabled:opacity-60"
          onClick={onConfirm}
          disabled={pending}
        >
          {t('admin.confirm')}
        </button>
      </div>
    </Modal>
  );
}
