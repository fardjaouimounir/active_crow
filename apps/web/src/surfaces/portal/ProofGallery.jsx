import { useEffect, useRef, useState } from 'react';
import { useFileObjectUrl } from '../../features/files/api.js';
import { usePortalQuery, usePortalText } from './api.js';

function Thumb({ id, label, onOpen }) {
  const file = useFileObjectUrl(id, 'thumbnail');
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={label}
      className="aspect-square overflow-hidden rounded-lg border border-line bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {file.url && <img src={file.url} alt="" className="size-full object-cover" />}
    </button>
  );
}

function Lightbox({ items, index, setIndex, close }) {
  const { t, date, wilaya } = usePortalText();
  const dialog = useRef(null);
  const item = items[index];
  const file = useFileObjectUrl(item.fileId);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);
  const move = (step) => setIndex((index + step + items.length) % items.length);
  return (
    <dialog
      ref={dialog}
      aria-label={t('photo')}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        // The arrows follow the reading direction of the page, not the screen.
        const rtl = document.documentElement.dir === 'rtl';
        if (event.key === 'ArrowRight') move(rtl ? -1 : 1);
        if (event.key === 'ArrowLeft') move(rtl ? 1 : -1);
      }}
      className="m-auto max-h-[92vh] w-[min(56rem,calc(100vw-1rem))] rounded-xl bg-surface p-4 backdrop:bg-scrim"
    >
      <div className="flex items-center justify-between gap-2 pb-2 text-sm">
        <p>
          <bdi dir="auto">{item.store}</bdi> · {wilaya(item.wilaya)} · <bdi>{date(item.date)}</bdi>
        </p>
        <button type="button" autoFocus onClick={close} className="rounded-md border px-3 py-1">
          {t('close')}
        </button>
      </div>
      <div className="flex min-h-48 items-center justify-center bg-sunken">
        {file.url && (
          <img
            src={file.url}
            alt={`${item.store} ${item.date}`}
            className="max-h-[70vh] object-contain"
          />
        )}
      </div>
      {items.length > 1 && (
        <div className="flex justify-between pt-3">
          <button type="button" className="rounded-md border px-3 py-1" onClick={() => move(-1)}>
            {t('previous')}
          </button>
          <span className="text-sm">
            {index + 1} / {items.length}
          </span>
          <button type="button" className="rounded-md border px-3 py-1" onClick={() => move(1)}>
            {t('next')}
          </button>
        </div>
      )}
    </dialog>
  );
}

/** Visit photos the agency chose to share: date, wilaya and store only. */
export function ProofGallery({ campaignId }) {
  const { t, date } = usePortalText();
  const query = usePortalQuery(`/portal/campaigns/${campaignId}/proof`);
  const [open, setOpen] = useState(null);
  const items = query.data ?? [];
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{t('proof')}</h2>
      {query.isPending && <p role="status">{t('loading')}</p>}
      {query.isError && <p role="alert">{t('error')}</p>}
      {query.data && !items.length && <p className="text-sm text-fg-2">{t('noProof')}</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((item, index) => (
          <Thumb
            key={item.fileId}
            id={item.fileId}
            label={`${t('photo')} ${index + 1}: ${item.store}, ${date(item.date)}`}
            onOpen={() => setOpen(index)}
          />
        ))}
      </div>
      {open !== null && (
        <Lightbox items={items} index={open} setIndex={setOpen} close={() => setOpen(null)} />
      )}
    </section>
  );
}
