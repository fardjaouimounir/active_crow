import { POLYGON_WILAYAS, RATIO_GEO_METRICS } from '@fieldflow/shared/wilayaPolygons';
import { useLayoutEffect, useMemo, useRef } from 'react';
import {
  BOUNDARIES,
  CLASSES,
  classOf,
  divergingClass,
  divergingToken,
  legendSteps,
  quantileBreaks,
  scaleToken,
  tokenColor,
} from './geo.js';
import { useGeoText } from './geoMessages.js';
import { MapView, upsertLayer, upsertSource } from './MapView.jsx';
import { SvgMap } from './SvgMap.jsx';

/**
 * Colours for one metric. Sequential: five quantile classes of the values, neutral to spring.
 * Change mode: diverging scale of (value - previous) per polygon. Both are documented in
 * docs/geo-data.md and computed from tokens, never from hard-coded colours.
 */
export function useChoroplethModel({ rows, previousRows, metric, compare, wilayaName, format }) {
  const { t, number, percent } = useGeoText();
  return useMemo(() => {
    const byCode = new Map(rows.map((row) => [row.polygonCode, row]));
    const before = new Map((previousRows ?? []).map((row) => [row.polygonCode, row.value ?? 0]));
    const ratio = RATIO_GEO_METRICS.includes(metric);
    const formatValue = format ?? (ratio ? percent : number);
    const change = new Map(
      rows.map((row) => [row.polygonCode, (row.value ?? 0) - (before.get(row.polygonCode) ?? 0)]),
    );
    const largest = Math.max(0, ...[...change.values()].map(Math.abs));
    const breaks = quantileBreaks(rows.map((row) => row.value));
    const tokens = {};
    for (const feature of BOUNDARIES.features) {
      const code = feature.properties.code;
      const row = byCode.get(code);
      tokens[code] =
        !row || row.value == null
          ? '--scale-none'
          : compare
            ? divergingToken(divergingClass(change.get(code), largest))
            : scaleToken(classOf(row.value, breaks));
    }
    const signed = (value) =>
      (value > 0 ? '+' : value < 0 ? '−' : '') + formatValue(Math.abs(value));
    const tooltipFor = (code) => {
      const row = byCode.get(code);
      const own = wilayaName(Number(code));
      if (!row) return [own, t('noData')];
      const lines = [
        own,
        compare
          ? `${t('change')}: ${signed(change.get(code))} (${formatValue(row.value)})`
          : `${t('metric.' + metric)}: ${formatValue(row.value)}`,
      ];
      if (row.rank != null)
        lines.push(t('rank', { rank: row.rank, count: rows.filter((r) => r.rank != null).length }));
      lines.push(
        `${number(row.kpis.salesUnits)} ${t('units')} · ${number(row.kpis.buyers)} ${t('buyersCount')}`,
      );
      if (row.included?.length)
        lines.push(
          `${t('includes')}: ${row.included.map((member) => wilayaName(member.id, member)).join(', ')}`,
        );
      return lines;
    };
    return { byCode, tokens, breaks, formatValue, signed, tooltipFor, compare, largest };
  }, [rows, previousRows, metric, compare, wilayaName, format, t, number, percent]);
}

/** Legend: the class ranges (or the change scale) with the period and the unit. */
export function ChoroplethLegend({ model, metric, period }) {
  const { t, date } = useGeoText();
  const swatch = (token) => (
    <span
      aria-hidden="true"
      className="legend-swatch inline-block size-3 rounded-sm border border-line"
      style={{ '--swatch': `var(${token})`, background: 'var(--swatch)' }}
    />
  );
  return (
    <div className="space-y-1.5 text-xs text-fg-2">
      <p className="font-medium text-fg">
        {model.compare ? t('change') : t('metric.' + metric)}
        {period && (
          <span className="ms-2 font-normal text-fg-3">
            {date(period.from)} – {date(period.to)}
          </span>
        )}
      </p>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {model.compare
          ? ['--div-neg-2', '--div-neg-1', '--div-0', '--div-pos-1', '--div-pos-2'].map((token) => (
              <li key={token} className="inline-flex items-center gap-1.5">
                {swatch(token)}
                {token.includes('neg') ? '−' : token.includes('pos') ? '+' : '0'}
              </li>
            ))
          : legendSteps(model.breaks).map(({ klass, from, to }) => (
              <li key={klass} className="tnum inline-flex items-center gap-1.5">
                {swatch(`--scale-${klass}`)}
                {to == null
                  ? `≥ ${model.formatValue(from)}`
                  : `${model.formatValue(from)} – ${model.formatValue(to)}`}
              </li>
            ))}
        <li className="inline-flex items-center gap-1.5">
          {swatch('--scale-none')}
          {t('noData')}
        </li>
      </ul>
    </div>
  );
}

/**
 * Wilaya choropleth. MapLibre when WebGL works (with a basemap if it loads, boundaries only if not);
 * a keyboard-operable SVG map otherwise. Clicking a wilaya calls `onSelect(code)`.
 */
export function ChoroplethMap({ model, selectedCodes, onSelect, height = '28rem' }) {
  const { t } = useGeoText();
  const live = useRef({});
  useLayoutEffect(() => {
    live.current = { model, selectedCodes, onSelect };
  });
  const fills = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(model.tokens).map(([code, token]) => [code, `var(${token})`]),
      ),
    [model.tokens],
  );
  const popup = useRef(null);

  function setup(map, lib) {
    const { model: current, selectedCodes: selected } = live.current;
    const features = BOUNDARIES.features.map((feature) => ({
      ...feature,
      properties: {
        code: feature.properties.code,
        fill: tokenColor(current.tokens[feature.properties.code], 'gray'),
        selected: selected.has(feature.properties.code) ? 1 : 0,
      },
    }));
    upsertSource(map, 'wilayas', { type: 'FeatureCollection', features });
    upsertLayer(map, {
      id: 'wilaya-fill',
      type: 'fill',
      source: 'wilayas',
      paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.82 },
    });
    upsertLayer(map, {
      id: 'wilaya-line',
      type: 'line',
      source: 'wilayas',
      paint: { 'line-color': tokenColor('--map-line', 'gray'), 'line-width': 0.7 },
    });
    upsertLayer(map, {
      id: 'wilaya-selected',
      type: 'line',
      source: 'wilayas',
      filter: ['==', ['get', 'selected'], 1],
      paint: { 'line-color': tokenColor('--map-select', 'white'), 'line-width': 2.5 },
    });
    if (map.__bound) return;
    map.__bound = true;
    popup.current = new lib.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 8,
      className: 'acticrew-popup',
    });
    map.on('mousemove', 'wilaya-fill', (event) => {
      const code = event.features?.[0]?.properties?.code;
      if (!code) return;
      map.getCanvas().style.cursor = 'pointer';
      const card = document.createElement('div');
      live.current.model.tooltipFor(code).forEach((line, index) => {
        const row = document.createElement('p');
        row.textContent = line;
        row.style.fontWeight = index === 0 ? '600' : '400';
        card.append(row);
      });
      popup.current.setLngLat(event.lngLat).setDOMContent(card).addTo(map);
    });
    map.on('mouseleave', 'wilaya-fill', () => {
      map.getCanvas().style.cursor = '';
      popup.current?.remove();
    });
    map.on('click', 'wilaya-fill', (event) => {
      const code = event.features?.[0]?.properties?.code;
      if (code) live.current.onSelect?.(code);
    });
  }

  return (
    <MapView
      label={t('mapLabel')}
      setup={setup}
      boundaries
      dataKey={model.tokens}
      height={height}
      fallback={
        <SvgMap
          fills={fills}
          selected={selectedCodes}
          onSelect={onSelect}
          tooltip={model.tooltipFor}
        />
      }
    />
  );
}

/** Wilaya ids a polygon stands for (its own wilaya plus the ones drawn inside it). */
export const wilayasOfPolygon = (code) => POLYGON_WILAYAS[code] ?? [];
export { CLASSES };
