import {
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Info,
  TriangleAlert,
  Minus,
} from 'lucide-react';
import { useId } from 'react';
import { LogoMark, Wordmark } from './brand.jsx';

import { Button, buttonClass, cn } from './button.jsx';

export { Button, buttonClass, cn };

/* ------------------------------------------------------------------ Brand */

export { LogoMark, Wordmark } from './brand.jsx';

/**
 * Forward arrow derived from the mark's diagonal. Up-right = better in LTR; mirrored in RTL so
 * "forward" always points the reading direction.
 */
export function ForwardArrow({ className = '', size = 16, down = false }) {
  return (
    <ArrowUpRight
      aria-hidden="true"
      size={size}
      strokeWidth={1.75}
      className={cn('shrink-0 rtl:-scale-x-100', down && 'rotate-90 rtl:-rotate-90', className)}
    />
  );
}

/* ------------------------------------------------------------ Form fields */

/** Shared look of every text-like control; borders are ≥ 3:1 (token `control`). */
export const controlClass =
  'block w-full rounded-md border border-control bg-surface px-3 h-9 text-sm text-fg transition-colors duration-[var(--dur-fast)] hover:border-fg-3 focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60 aria-[invalid=true]:border-danger';

export function Input({ className, ...props }) {
  return <input className={cn(controlClass, className)} {...props} />;
}

export function Textarea({ className, ...props }) {
  return <textarea className={cn(controlClass, 'h-auto min-h-20 py-2', className)} {...props} />;
}

export function SelectControl({ className, children, ...props }) {
  return (
    <select className={cn(controlClass, 'pe-8', className)} {...props}>
      {children}
    </select>
  );
}

const choice =
  'size-4 shrink-0 appearance-none border border-control bg-surface checked:border-fg checked:bg-accent disabled:opacity-50';

/** Checkbox with the tick drawn in the accent-foreground color. */
export function Checkbox({ className, ...props }) {
  return (
    <input
      type="checkbox"
      className={cn(
        choice,
        'rounded-sm checked:bg-[image:var(--check)] checked:bg-center checked:bg-no-repeat',
        className,
      )}
      style={{
        '--check':
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M3.5 8.5l3 3 6-7' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>\")",
      }}
      {...props}
    />
  );
}

export function Radio({ className, ...props }) {
  return (
    <input
      type="radio"
      className={cn(
        choice,
        'rounded-full checked:shadow-[inset_0_0_0_3px_var(--surface)]',
        className,
      )}
      {...props}
    />
  );
}

/** On/off switch (role="switch"); controlled through `checked` + `onChange`. */
export function Switch({ label, className, ...props }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn('inline-flex cursor-pointer items-center gap-2 text-sm', className)}
    >
      <input id={id} type="checkbox" role="switch" className="peer sr-only" {...props} />
      <span
        aria-hidden="true"
        className="relative h-5 w-9 rounded-full border border-control bg-sunken transition-colors duration-[var(--dur-base)] peer-checked:border-fg peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-50 after:absolute after:start-0.5 after:top-0.5 after:size-3.5 after:rounded-full after:bg-fg-2 after:transition-transform after:duration-[var(--dur-base)] peer-checked:after:translate-x-4 peer-checked:after:bg-accent-fg rtl:peer-checked:after:-translate-x-4"
      />
      {label}
    </label>
  );
}

/** Range of two ISO business dates (from / to), each a native date control. */
export function DateRange({ from, to, onChange, fromLabel, toLabel }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label={fromLabel}
        value={from ?? ''}
        max={to || undefined}
        onChange={(event) => onChange({ from: event.target.value, to })}
      />
      <span aria-hidden="true" className="text-fg-3">
        –
      </span>
      <Input
        type="date"
        aria-label={toLabel}
        value={to ?? ''}
        min={from || undefined}
        onChange={(event) => onChange({ from, to: event.target.value })}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */

const TONES = {
  neutral: { className: 'bg-sunken text-fg-2 border-line', Icon: Minus },
  good: { className: 'bg-success-soft text-success border-success-line', Icon: CircleCheck },
  warn: { className: 'bg-warning-soft text-warning border-warning-line', Icon: TriangleAlert },
  bad: { className: 'bg-danger-soft text-danger border-danger-line', Icon: CircleX },
  info: { className: 'bg-info-soft text-info border-info-line', Icon: Info },
  accent: { className: 'bg-accent-soft text-accent-text border-accent-line', Icon: CircleAlert },
};

/** Status pill: color + icon + text, never color alone. */
export function Badge({ tone = 'neutral', icon = true, className, children }) {
  const { className: toneClass, Icon } = TONES[tone] ?? TONES.neutral;
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-xs font-medium whitespace-nowrap',
        toneClass,
        className,
      )}
    >
      {icon && <Icon aria-hidden="true" size={12} strokeWidth={2} />}
      {children}
    </span>
  );
}

/* ----------------------------------------------------------------- Avatar */

const AVATAR_SIZES = { sm: 'size-6 text-2xs', md: 'size-8 text-xs', lg: 'size-10 text-sm' };

/** Initials on a rounded square (the app-icon shape, radius ≈ 22 %). */
export function Avatar({ name = '', size = 'md', className }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0])
    .join('')
    .toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{ borderRadius: '22%' }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-accent-soft font-semibold text-accent-text select-none',
        AVATAR_SIZES[size],
        className,
      )}
    >
      {initials || '·'}
    </span>
  );
}

/* --------------------------------------------------------------- Skeleton */

export function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-sunken', className)} />;
}

/* ------------------------------------------------------------------ Delta */

/**
 * Signed change with arrow + color + text. `good` says whether an increase is better
 * (e.g. false for rejected rows).
 */
export function Delta({ value, format, good = true, label }) {
  if (value == null || Number.isNaN(value)) return null;
  const up = value > 0;
  const flat = value === 0;
  const better = flat ? null : up === good;
  const text = format ? format(Math.abs(value)) : String(Math.abs(value));
  return (
    <span
      className={cn(
        'tnum inline-flex items-center gap-0.5 text-xs font-medium',
        flat ? 'text-fg-3' : better ? 'text-success' : 'text-danger',
      )}
    >
      {flat ? <Minus aria-hidden="true" size={12} /> : <ForwardArrow size={12} down={!up} />}
      <span dir="ltr">{(up ? '+' : flat ? '' : '−') + text}</span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}

/** Letterhead for printed reports: mark + wordmark + tagline, black on white, hidden on screen. */
export function PrintBrand({ tagline }) {
  return (
    <div className="print-brand hidden items-center gap-3 border-b-2 border-brand-black pb-3 print:flex">
      <LogoMark size={36} />
      <Wordmark className="text-xl text-brand-black" />
      {tagline && <span className="ms-auto text-xs text-brand-black">{tagline}</span>}
    </div>
  );
}
