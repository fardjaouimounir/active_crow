import { useId } from 'react';
import { CircleAlert, CircleCheck, CircleX, Clock, Minus, TriangleAlert } from 'lucide-react';
import { useFormat } from './format.js';
import { Badge, ForwardArrow, cn } from './primitives.jsx';
import { Tooltip } from './overlays.jsx';

/* --------------------------------------------------------------- Sparkline */

/**
 * Tiny trend line with a soft area, drawn in the main data color (spring). Time always runs left to
 * right, also in RTL. `ghost` is an optional previous-period line in a neutral tone.
 */
export function Sparkline({ values, ghost, label, height = 28, className }) {
  const id = useId();
  const series = (values ?? []).map((value) => (Number.isFinite(value) ? value : 0));
  if (series.length < 2) return <div style={{ height }} aria-hidden="true" />;
  const all = [...series, ...(ghost ?? [])];
  const max = Math.max(...all, 1);
  const min = Math.min(...all, 0);
  const span = max - min || 1;
  const w = 100;
  const point = (value, index, count) =>
    `${((index / (count - 1)) * w).toFixed(2)},${(height - 2 - ((value - min) / span) * (height - 4)).toFixed(2)}`;
  const line = series.map((value, index) => point(value, index, series.length)).join(' ');
  const ghostLine = ghost?.length > 1 && ghost.map((v, i) => point(v, i, ghost.length)).join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      dir="ltr"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : 'true'}
      className={cn('block overflow-visible', className)}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--chart-1)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ghostLine && (
        <polyline
          points={ghostLine}
          fill="none"
          stroke="var(--chart-4)"
          strokeWidth="1"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
          opacity="0.7"
        />
      )}
      <polygon points={`0,${height} ${line} ${w},${height}`} fill={`url(#${id})`} />
      <polyline
        points={line}
        fill="none"
        stroke="var(--chart-1)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ------------------------------------------------------------ ProgressBar */

/** Thin progress bar. `value` and `target` share a unit; without a target it is just a fraction. */
export function ProgressBar({ value, max = 1, label, tone = 'accent', className }) {
  const fraction = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const color = tone === 'warn' ? 'bg-warning' : tone === 'bad' ? 'bg-danger' : 'bg-accent';
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      className={cn('h-1 w-full overflow-hidden rounded-full bg-sunken', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-[var(--dur-slow)]', color)}
        style={{ width: `${fraction * 100}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------- StackedBar */

const SEGMENT = {
  accent: 'bg-accent',
  success: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
  info: 'bg-info',
  muted: 'bg-line-strong',
  soft: 'bg-accent-line',
};

/**
 * One horizontal bar split into segments. Meaning never rides on color alone: every segment is
 * also listed as text with its count (`legend`).
 */
export function StackedBar({ segments, legend = true, className }) {
  const { num } = useFormat();
  const total = segments.reduce((sum, segment) => sum + (segment.value || 0), 0);
  return (
    <div className={cn('space-y-2', className)}>
      <div
        role="img"
        aria-label={segments.map((s) => `${s.label}: ${s.value}`).join(', ')}
        className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-sunken"
      >
        {total > 0 &&
          segments
            .filter((segment) => segment.value > 0)
            .map((segment) => (
              <div
                key={segment.key ?? segment.label}
                className={cn(SEGMENT[segment.tone] ?? SEGMENT.muted)}
                style={{ width: `${(segment.value / total) * 100}%` }}
              />
            ))}
      </div>
      {legend && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
          {segments.map((segment) => (
            <li key={segment.key ?? segment.label} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn('size-2 rounded-xs', SEGMENT[segment.tone] ?? SEGMENT.muted)}
              />
              <span>{segment.label}</span>
              <span className="tnum font-medium text-fg">{num(segment.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- StatusPill */

const PILL = {
  good: { tone: 'good' },
  warn: { tone: 'warn' },
  bad: { tone: 'bad' },
  info: { tone: 'info' },
  neutral: { tone: 'neutral' },
  accent: { tone: 'accent' },
};

/** Status = icon + label + tone (never color alone). Thin wrapper over Badge for one vocabulary. */
export function StatusPill({ tone = 'neutral', children, className, icon }) {
  const Icon = icon;
  return (
    <Badge tone={(PILL[tone] ?? PILL.neutral).tone} icon={!Icon} className={className}>
      {Icon && <Icon aria-hidden="true" size={12} strokeWidth={2} />}
      {children}
    </Badge>
  );
}

export const PILL_ICONS = { good: CircleCheck, warn: TriangleAlert, bad: CircleX, info: CircleAlert, neutral: Minus, wait: Clock };

/* ------------------------------------------------------------------- Ago */

/** Relative time with the absolute date in a tooltip. */
export function Ago({ at, className }) {
  const { ago, when } = useFormat();
  if (!at) return <span className={className}>—</span>;
  return (
    <Tooltip label={when(at)}>
      <time dateTime={new Date(at).toISOString()} className={cn('tnum', className)}>
        {ago(at)}
      </time>
    </Tooltip>
  );
}

/* ----------------------------------------------------------------- Section */

/** Section title with a hairline divider instead of one more card around secondary content. */
export function Section({ title, hint, actions, children, className }) {
  return (
    <section className={cn('min-w-0', className)}>
      <header className="mb-3 flex items-end justify-between gap-3 border-b border-line pb-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-fg">{title}</h2>
          {hint && <p className="text-xs text-fg-3">{hint}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Raised surface (the second of the three levels: canvas, section surface, overlay). */
export function Surface({ children, className, as: Tag = 'div' }) {
  return (
    <Tag className={cn('rounded-lg border border-line bg-surface', className)}>{children}</Tag>
  );
}

export { ForwardArrow };
