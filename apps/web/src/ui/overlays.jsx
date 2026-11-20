import { X } from 'lucide-react';
import { cloneElement, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, cn } from './primitives.jsx';

/**
 * Native modal: focus trap, Esc handling and focus restoration come from <dialog>.
 * `drawer` docks it to the inline-end edge (left in RTL) with a 200 ms slide.
 */
export function Dialog({ title, onClose, children, drawer = false, width }) {
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
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === dialog.current) onClose();
      }}
      className={cn(
        'fixed overflow-y-auto border border-line bg-raised p-0 text-fg shadow-xl',
        drawer
          ? 'ui-drawer m-0 ms-auto me-0 h-dvh max-h-none w-[min(34rem,100vw)] rounded-none border-y-0 border-e-0'
          : 'ui-dialog m-auto max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] rounded-xl',
      )}
      style={width ? { width: `min(${width}, 100vw)` } : undefined}
    >
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-3.5">
        <h2 id={heading} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('admin.close')}
          className="-me-1.5 inline-flex size-7 items-center justify-center rounded-md text-fg-2 hover:bg-sunken hover:text-fg"
        >
          <X aria-hidden="true" size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

export function Drawer(props) {
  return <Dialog drawer {...props} />;
}

/** Confirms a destructive change before invoking the supplied action. */
export function ConfirmDialog({
  title,
  message,
  pending,
  onClose,
  onConfirm,
  children,
  tone = 'danger',
}) {
  const { t } = useTranslation('common');
  return (
    <Dialog title={title} onClose={pending ? () => {} : onClose}>
      <p className="mb-4 text-sm text-fg-2">{message}</p>
      {children}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          {t('admin.cancel')}
        </Button>
        <Button variant={tone} onClick={onConfirm} disabled={pending}>
          {t('admin.confirm')}
        </Button>
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- Popover */

/** Click-to-open panel anchored to its trigger; closes on Esc and outside click. */
export function Popover({ trigger, children, align = 'end', className, label, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const id = useId();
  const change = useCallback(
    (next) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!root.current?.contains(event.target)) change(false);
    };
    const escape = (event) => {
      if (event.key === 'Escape') change(false);
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, change]);
  return (
    <div ref={root} className="relative">
      {cloneElement(trigger, {
        'aria-expanded': open,
        'aria-controls': id,
        'aria-haspopup': 'true',
        onClick: () => change(!open),
      })}
      {open && (
        <div
          id={id}
          role="group"
          aria-label={label}
          className={cn(
            'absolute top-full z-30 mt-1.5 min-w-56 rounded-lg border border-line bg-raised p-1.5 shadow-lg',
            align === 'end' ? 'end-0' : 'start-0',
            className,
          )}
        >
          {typeof children === 'function' ? children({ close: () => change(false) }) : children}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Tooltip */

/** CSS tooltip shown on hover and keyboard focus of the wrapped control. */
export function Tooltip({ label, children, side = 'top' }) {
  const id = useId();
  return (
    <span className="group/tip relative inline-flex">
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute start-1/2 z-30 w-max max-w-56 -translate-x-1/2 rounded-md border border-line bg-raised px-2 py-1 text-xs text-fg opacity-0 shadow-md transition-opacity duration-[var(--dur-fast)] group-focus-within/tip:opacity-100 group-hover/tip:opacity-100 rtl:translate-x-1/2',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {label}
      </span>
    </span>
  );
}

export { ToastProvider, useToast } from './toast.jsx';
