import { useMemo, useState } from 'react';
import { ALGERIA_BOUNDS, BOUNDARIES, boundsOf, geometryPath, makeProjector } from './geo.js';
import { useGeoText } from './geoMessages.js';

const WIDTH = 640;
const HEIGHT = 520;

/**
 * Boundaries drawn as plain SVG: the map when WebGL or the basemap is unavailable, the keyboard
 * path through the wilayas, and the static snapshot printed in reports (no script, no tiles).
 *
 * `fills` maps polygon code -> CSS colour (token var); `selected` is a Set of polygon codes;
 * `points` = [{ id, longitude, latitude, radius, fill, label, shape }] drawn over the outlines.
 * `tooltip(code)` returns text lines for the hover/focus card; omit it for a static map.
 */
export function SvgMap({
  label,
  fills = {},
  selected = new Set(),
  onSelect,
  tooltip,
  points = [],
  onPoint,
  focus,
  className = '',
  interactive = true,
}) {
  const { t, rtl } = useGeoText();
  const [hover, setHover] = useState(null);
  const bounds = focus ?? ALGERIA_BOUNDS;
  const project = useMemo(() => makeProjector(bounds, WIDTH, HEIGHT), [bounds]);
  const paths = useMemo(
    () =>
      BOUNDARIES.features.map((feature) => ({
        code: feature.properties.code,
        d: geometryPath(feature.geometry, project),
      })),
    [project],
  );
  const lines = hover && tooltip ? tooltip(hover) : null;
  return (
    <figure className={'relative m-0 ' + className}>
      <svg
        role={interactive ? 'group' : 'img'}
        aria-label={label ?? t('mapLabel')}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full rounded-lg border border-line bg-surface"
        // Geography is not mirrored: the map keeps north up and west on the left in both directions.
        dir="ltr"
      >
        {paths.map(({ code, d }) => {
          const isSelected = selected.has(code);
          const text = tooltip ? tooltip(code).join(', ') : code;
          return (
            <path
              key={code}
              d={d}
              fill={fills[code] ?? 'var(--scale-none)'}
              stroke={isSelected ? 'var(--map-select)' : 'var(--map-line)'}
              strokeWidth={isSelected ? 2.2 : 0.7}
              strokeLinejoin="round"
              {...(interactive && onSelect
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': text,
                    'aria-pressed': isSelected,
                    className:
                      'cursor-pointer outline-none focus-visible:[stroke:var(--focus)] focus-visible:[stroke-width:3]',
                    onClick: () => onSelect(code),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelect(code);
                      }
                    },
                    onMouseEnter: () => setHover(code),
                    onMouseLeave: () => setHover(null),
                    onFocus: () => setHover(code),
                    onBlur: () => setHover(null),
                  }
                : {})}
            />
          );
        })}
        {points.map((point) => {
          const [x, y] = project([point.longitude, point.latitude]);
          const interactivePoint = interactive && onPoint;
          return (
            <circle
              key={point.id}
              cx={x}
              cy={y}
              r={point.radius ?? 4}
              fill={point.hollow ? 'none' : (point.fill ?? 'var(--accent)')}
              stroke={point.hollow ? (point.fill ?? 'var(--accent)') : 'var(--surface)'}
              strokeWidth={point.hollow ? 2 : 1}
              {...(interactivePoint
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': point.label,
                    className:
                      'cursor-pointer outline-none focus-visible:[stroke:var(--focus)] focus-visible:[stroke-width:3]',
                    onClick: () => onPoint(point.id),
                    onKeyDown: (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onPoint(point.id);
                      }
                    },
                  }
                : { 'aria-hidden': true })}
            >
              <title>{point.label}</title>
            </circle>
          );
        })}
      </svg>
      {lines && (
        <figcaption
          dir={rtl ? 'rtl' : 'ltr'}
          className="pointer-events-none absolute start-2 top-2 max-w-64 rounded-md border border-line bg-raised px-2.5 py-1.5 text-xs text-fg shadow-md"
        >
          {lines.map((line, index) => (
            <p key={index} className={index === 0 ? 'font-semibold' : 'text-fg-2'}>
              {line}
            </p>
          ))}
        </figcaption>
      )}
      <p className="mt-1 text-2xs text-fg-3">{t('attribution')}</p>
    </figure>
  );
}

/** The bounding box that frames a set of stores (with margin), for the SVG fallback. */
export function focusOn(points) {
  if (!points.length) return ALGERIA_BOUNDS;
  const [[west, south], [east, north]] = boundsOf(points.map((p) => [p.longitude, p.latitude]));
  const margin = Math.max(0.6, (east - west) * 0.15, (north - south) * 0.15);
  return [
    [west - margin, south - margin],
    [east + margin, north + margin],
  ];
}
