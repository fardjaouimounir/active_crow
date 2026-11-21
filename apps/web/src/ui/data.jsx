import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Delta, ForwardArrow, cn } from './primitives.jsx';
import { ProgressBar } from './viz.jsx';

/* ------------------------------------------------------------------ Table */

const DENSITY_KEY = 'acticrew.density';
const densityListeners = new Set();
function readDensity() {
  try {
    return window.localStorage.getItem(DENSITY_KEY) === 'comfortable' ? 'comfortable' : 'compact';
  } catch {
    return 'compact';
  }
}
let density = 'compact';
let densityLoaded = false;
function currentDensity() {
  if (!densityLoaded) {
    density = readDensity();
    densityLoaded = true;
  }
  return density;
}

/** Row density (compact by default for an ops tool), remembered per browser. */
export function useDensity() {
  const value = useSyncExternalStore(
    (listener) => {
      densityListeners.add(listener);
      return () => densityListeners.delete(listener);
    },
    currentDensity,
    () => 'compact',
  );
  return [
    value,
    (next) => {
      density = next;
      try {
        window.localStorage.setItem(DENSITY_KEY, next);
      } catch {
        /* session only */
      }
      for (const listener of densityListeners) listener();
    },
  ];
}

export function DensityToggle() {
  const { t } = useTranslation('common');
  const [value, setValue] = useDensity();
  return (
    <div
      role="group"
      aria-label={t('ui.density.label')}
      className="inline-flex rounded-md border border-line p-0.5"
    >
      {['compact', 'comfortable'].map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => setValue(option)}
          className={cn(
            'rounded px-2 py-0.5 text-xs font-medium transition-colors duration-[var(--dur-fast)]',
            value === option ? 'bg-sunken text-fg' : 'text-fg-3 hover:text-fg',
          )}
        >
          {t('ui.density.' + option)}
        </button>
      ))}
    </div>
  );
}

/** Frame that gives a <table> the hairline border, rounded corners and horizontal scroll. */
export function TableFrame({ children, className }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}>
      {children}
    </div>
  );
}

/** Classes for table parts; `numeric` right-aligns (logical end) for comparable figures. */
export const tableClass = {
  table: 'w-full border-collapse text-start text-sm',
  head: 'sticky top-0 z-10 bg-sunken',
  th: (compact = true, numeric = false) =>
    cn(
      'border-b border-line text-start text-xs font-medium uppercase tracking-wide text-fg-3',
      compact ? 'px-3 py-2' : 'px-4 py-3',
      numeric && 'text-end',
    ),
  td: (compact = true, numeric = false) =>
    cn('align-middle', compact ? 'px-3 py-1.5' : 'px-4 py-3', numeric && 'tnum text-end'),
  row: (interactive = false, selected = false) =>
    cn(
      'border-t border-line first:border-t-0',
      interactive && 'cursor-pointer hover:bg-sunken',
      selected && 'bg-accent-soft',
    ),
};

/** Sortable column header button with arrow state; the th carries `aria-sort`. */
export function SortHeader({ children, direction, onClick }) {
  const Icon =
    direction === 'asc' ? ChevronUp : direction === 'desc' ? ChevronDown : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-1 inline-flex items-center gap-1 rounded px-1 uppercase hover:text-fg"
    >
      {children}
      <Icon
        aria-hidden="true"
        size={12}
        strokeWidth={2}
        className={direction ? 'text-fg' : 'text-fg-3'}
      />
    </button>
  );
}

/* ------------------------------------------------------------- Pagination */

export function Pagination({
  page,
  pages,
  onPage,
  format = (value) => String(value),
  bare = false,
}) {
  const { t } = useTranslation('common');
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-3 py-2 text-xs text-fg-2',
        !bare && 'border-t border-line',
      )}
    >
      <span className="tnum">
        {t('admin.page', { page: format(page), pages: format(Math.max(1, pages)) })}
      </span>
      <div className="flex gap-1">
        <Button size="sm" variant="secondary" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft aria-hidden="true" size={14} className="rtl:-scale-x-100" />
          {t('admin.previous')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
        >
          {t('admin.next')}
          <ChevronRight aria-hidden="true" size={14} className="rtl:-scale-x-100" />
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- Tabs */

/** Accessible tab strip with roving arrow-key focus; the caller owns the value (keep it in the URL). */
export function TabStrip({ label, tabs, value, onChange, idPrefix }) {
  const refs = useRef([]);
  function move(event, index) {
    const last = tabs.length - 1;
    const keys = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last };
    if (!(event.key in keys)) return;
    event.preventDefault();
    // Arrow keys follow the reading direction.
    const rtl = document.documentElement.dir === 'rtl';
    let target = keys[event.key];
    if (rtl && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      target = event.key === 'ArrowRight' ? index - 1 : index + 1;
    }
    target = (target + tabs.length) % tabs.length;
    refs.current[target]?.focus();
    onChange(tabs[target].value);
  }
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-4 flex flex-wrap gap-x-1 border-b border-line"
    >
      {tabs.map((tab, index) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="tab"
            id={idPrefix + '-tab-' + tab.value}
            aria-selected={selected}
            aria-controls={idPrefix + '-panel'}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => move(event, index)}
            onClick={() => onChange(tab.value)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-[var(--dur-fast)]',
              selected
                ? 'border-accent-text font-semibold text-fg'
                : 'border-transparent text-fg-3 hover:text-fg',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ Breadcrumbs */

export function Breadcrumbs({ items, label }) {
  if (!items?.length) return null;
  return (
    <nav aria-label={label} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-fg-3">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <Fragment key={item.to ?? item.label}>
              <li className="min-w-0 truncate">
                {last || !item.to ? (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={last ? 'font-medium text-fg' : ''}
                  >
                    {item.label}
                  </span>
                ) : (
                  <Link to={item.to} className="hover:text-fg hover:underline">
                    {item.label}
                  </Link>
                )}
              </li>
              {!last && (
                <li aria-hidden="true" className="text-fg-3">
                  <ChevronRight size={14} className="rtl:-scale-x-100" />
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------- Stepper */

/**
 * Campaign lifecycle stepper. `steps` = [{ key, label }], `current` = key of the current step.
 * Done steps get an accent tick, the current step a filled accent dot.
 */
export function Stepper({ steps, current, label, compact = false }) {
  const index = Math.max(
    0,
    steps.findIndex((step) => step.key === current),
  );
  return (
    <ol aria-label={label} className={cn('flex items-center', compact ? 'gap-1.5' : 'gap-2')}>
      {steps.map((step, position) => {
        const done = position < index;
        const active = position === index;
        return (
          <Fragment key={step.key}>
            <li
              aria-current={active ? 'step' : undefined}
              className={cn(
                'flex items-center gap-1.5 text-xs whitespace-nowrap',
                active ? 'font-semibold text-fg' : done ? 'text-fg-2' : 'text-fg-3',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'inline-block rounded-full border',
                  compact ? 'size-2' : 'size-2.5',
                  active
                    ? 'border-accent bg-accent'
                    : done
                      ? 'border-accent-text bg-accent-text'
                      : 'border-control bg-transparent',
                )}
              />
              <span className={compact ? 'sr-only' : ''}>{step.label}</span>
              {compact && active && <span aria-hidden="true">{step.label}</span>}
            </li>
            {position < steps.length - 1 && (
              <li
                aria-hidden="true"
                className={cn('h-px w-4 sm:w-6', done ? 'bg-accent-text' : 'bg-line-strong')}
              />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------- KPI & empty */

/**
 * Counts up once, on the first render of a KPI (never on re-fetches). Only runs when the browser
 * positively reports no reduced-motion preference, so tests and reduced-motion users see the value at once.
 */
function useCountUp(target, enabled) {
  const [progress, setProgress] = useState(() =>
    enabled &&
    typeof target === 'number' &&
    window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches === true
      ? 0
      : 1,
  );
  useEffect(() => {
    if (progress >= 1) return undefined;
    const started = performance.now();
    let frame;
    const tick = (now) => {
      const next = Math.min(1, (now - started) / 600);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Runs once: the count-up is a first-load effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return progress >= 1 || typeof target !== 'number' ? target : target * (1 - (1 - progress) ** 3);
}

/**
 * KPI: label, value, delta (arrow + sign + color), period and an optional sparkline slot.
 * `value` is formatted by the caller through `format` so units and locale stay in one place.
 */
export function KpiTile({
  label,
  value,
  format = (number) => String(number),
  delta,
  deltaFormat,
  deltaGood = true,
  deltaLabel,
  period,
  unit,
  sparkline,
  progress,
  hero = false,
  className,
  animate = true,
}) {
  const shown = useCountUp(value, animate);
  return (
    <div className={cn('flex min-w-0 flex-col px-4 py-3.5', hero && 'sm:col-span-2', className)}>
      <dt className="truncate text-xs font-medium text-fg-3">{label}</dt>
      <dd className="mt-1.5 flex items-baseline gap-1.5">
        <span
          className={cn(
            'tnum font-semibold tracking-tight text-fg',
            hero ? 'text-4xl' : 'text-2xl',
          )}
        >
          {typeof value === 'number' ? format(shown) : (value ?? '—')}
        </span>
        {unit && <span className="text-xs text-fg-3">{unit}</span>}
      </dd>
      <dd className="mt-1 flex min-h-4 flex-wrap items-center gap-x-2 text-xs text-fg-3">
        {delta != null && (
          <Delta value={delta} format={deltaFormat} good={deltaGood} label={deltaLabel} />
        )}
        {period && <span>{period}</span>}
      </dd>
      {progress && (
        <dd className="mt-2.5 space-y-1">
          <ProgressBar
            value={progress.value}
            max={progress.max}
            label={progress.label}
            tone={progress.tone}
          />
          {progress.caption && <span className="block text-2xs text-fg-3">{progress.caption}</span>}
        </dd>
      )}
      {sparkline && <dd className="mt-auto pt-3">{sparkline}</dd>}
    </div>
  );
}

/** KPI group: one bordered strip with hairline dividers instead of a row of identical cards. */
export function KpiStrip({ children, className }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border border-line bg-surface', className)}>
      <dl className="-me-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 [&>*]:border-b [&>*]:border-e [&>*]:border-line">
        {children}
      </dl>
    </div>
  );
}

/** Empty state with the brand stripe and a forward arrow; copy is passed in already written for the context. */
export function EmptyState({ title, message, children, stripe = true, className }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-dashed border-line-strong bg-surface p-8',
        className,
      )}
    >
      {stripe && (
        <div
          aria-hidden="true"
          className="brand-stripe absolute inset-x-0 top-0 h-1.5 opacity-90"
        />
      )}
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          style={{ borderRadius: '22%' }}
          className="inline-flex size-8 shrink-0 items-center justify-center bg-accent text-accent-fg"
        >
          <ForwardArrow size={16} />
        </span>
        <div className="min-w-0 space-y-1">
          {title && <p className="font-semibold text-fg">{title}</p>}
          <p className="text-sm text-fg-2">{message}</p>
          {children && <div className="pt-2">{children}</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Timeline */

const TIMELINE_TONES = {
  neutral: 'border-line-strong bg-sunken text-fg-2',
  good: 'border-success-line bg-success-soft text-success',
  warn: 'border-warning-line bg-warning-soft text-warning',
  bad: 'border-danger-line bg-danger-soft text-danger',
  accent: 'border-accent-line bg-accent-soft text-accent-text',
};

/** Vertical chain of steps joined by a rail (e.g. sale → entitlement → delivery → Tombola). */
export function Timeline({ children, label }) {
  return (
    <ol aria-label={label} className="grid">
      {children}
    </ol>
  );
}

export function TimelineStep({ icon: Icon, title, tone = 'neutral', last = false, children }) {
  return (
    <li className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-7 shrink-0 items-center justify-center rounded-full border',
            TIMELINE_TONES[tone],
          )}
        >
          <Icon size={14} strokeWidth={1.75} />
        </span>
        {!last && <span aria-hidden="true" className="my-1 w-px flex-1 bg-line-strong" />}
      </div>
      <div className={cn('min-w-0 pb-5', last && 'pb-0')}>
        <h3 className="flex h-7 items-center text-sm font-semibold tracking-tight">{title}</h3>
        <div className="text-sm text-fg-2">{children}</div>
      </div>
    </li>
  );
}
