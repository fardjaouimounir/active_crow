import { useLayoutEffect, useMemo, useRef } from 'react';
import { boundsOf, reducedMotion, tokenColor } from './geo.js';
import { useGeoText } from './geoMessages.js';
import { MapView, upsertLayer, upsertSource } from './MapView.jsx';
import { SvgMap, focusOn } from './SvgMap.jsx';

export const COLOR_MODES = ['visit', 'issues', 'attendance', 'today'];
const DAY = 86_400_000;

/**
 * How a store is coloured for a mode. Colour is never the only cue: each status has a label (legend,
 * list, tooltip) and "not sent" is drawn hollow.
 * @returns {{ key: string, token: string, hollow?: boolean }}
 */
export function statusOf(store, mode, now = Date.now()) {
  if (mode === 'plain') return { key: 'stores', token: '--accent-text' };
  if (mode === 'visit') {
    const days = store.lastVisit ? (now - Date.parse(store.lastVisit)) / DAY : Infinity;
    return days <= 7
      ? { key: 'visited', token: '--success' }
      : { key: 'notVisited', token: '--warning' };
  }
  if (mode === 'issues')
    return store.openIssues > 0
      ? { key: 'hasIssues', token: '--danger' }
      : { key: 'noIssues', token: '--fg-3' };
  if (mode === 'attendance') {
    const rate = store.attendanceRate;
    if (rate == null) return { key: 'noData', token: '--fg-3' };
    if (rate >= 0.8) return { key: 'attendanceGood', token: '--success' };
    return rate >= 0.5
      ? { key: 'attendanceMid', token: '--warning' }
      : { key: 'attendanceLow', token: '--danger' };
  }
  const today = store.today;
  if (!today || !today.animateurs) return { key: 'noToday', token: '--fg-3', hollow: true };
  if (today.absent > 0) return { key: 'absent', token: '--danger' };
  if (today.notSent > 0) return { key: 'notSent', token: '--info', hollow: true };
  if (today.late > 0) return { key: 'late', token: '--warning' };
  return { key: 'present', token: '--success' };
}

const radiusOf = (units, max) => 5 + 11 * Math.sqrt(max > 0 ? units / max : 0);

/** Legend and counts for the current mode. */
export function StoreLegend({ stores, mode }) {
  const { t, number } = useGeoText();
  const entries = useMemo(() => {
    const counts = new Map();
    for (const store of stores) {
      const status = statusOf(store, mode);
      const entry = counts.get(status.key) ?? { ...status, count: 0 };
      entry.count += 1;
      counts.set(status.key, entry);
    }
    return [...counts.values()];
  }, [stores, mode]);
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2"
      aria-label={t('colorBy.' + mode)}
    >
      {entries.map((entry) => (
        <li key={entry.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-3 rounded-full border-2"
            style={{
              borderColor: `var(${entry.token})`,
              background: entry.hollow ? 'transparent' : `var(${entry.token})`,
            }}
          />
          {t(entry.key)} <span className="tnum font-semibold text-fg">{number(entry.count)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Stores as points: size = sales units, colour = status (see statusOf), optional clustering and a
 * sales-density heatmap. Clicking a store calls `onSelect(id)`.
 */
export function StoreMap({
  stores,
  mode,
  heat = false,
  cluster = true,
  onSelect,
  height = '28rem',
}) {
  const { t, number } = useGeoText();
  const live = useRef({});
  useLayoutEffect(() => {
    live.current = { stores, mode, heat, onSelect };
  });
  const maxUnits = Math.max(0, ...stores.map((store) => store.salesUnits ?? 0));
  const key = useMemo(() => ({ stores, mode, heat }), [stores, mode, heat]);

  function setup(map, lib) {
    const { stores: items, mode: colorMode, heat: showHeat } = live.current;
    const max = Math.max(0, ...items.map((store) => store.salesUnits ?? 0));
    const features = items.map((store) => {
      const status = statusOf(store, colorMode);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [store.longitude, store.latitude] },
        properties: {
          id: store.id,
          name: store.name,
          units: store.salesUnits ?? 0,
          r: radiusOf(store.salesUnits ?? 0, max),
          color: tokenColor(status.token, 'gray'),
          hollow: status.hollow ? 1 : 0,
        },
      };
    });
    const data = { type: 'FeatureCollection', features };
    upsertSource(
      map,
      'stores',
      data,
      cluster ? { cluster: true, clusterRadius: 44, clusterMaxZoom: 10 } : {},
    );
    upsertSource(map, 'stores-heat', data);
    const scale = [1, 2, 3, 4, 5].map((step) => tokenColor(`--scale-${step}`, 'gray'));
    upsertLayer(map, {
      id: 'stores-heat',
      type: 'heatmap',
      source: 'stores-heat',
      layout: { visibility: showHeat ? 'visible' : 'none' },
      paint: {
        'heatmap-weight': ['interpolate', ['linear'], ['get', 'units'], 0, 0, Math.max(max, 1), 1],
        'heatmap-radius': 28,
        'heatmap-opacity': 0.8,
        'heatmap-color': [
          'interpolate',
          ['linear'],
          ['heatmap-density'],
          0,
          'rgba(0,0,0,0)',
          0.2,
          scale[0],
          0.4,
          scale[1],
          0.6,
          scale[2],
          0.8,
          scale[3],
          1,
          scale[4],
        ],
      },
    });
    map.setLayoutProperty('stores-heat', 'visibility', showHeat ? 'visible' : 'none');
    if (cluster) {
      upsertLayer(map, {
        id: 'clusters',
        type: 'circle',
        source: 'stores',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': tokenColor('--accent', 'green'),
          'circle-opacity': 0.9,
          'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 24],
          'circle-stroke-width': 2,
          'circle-stroke-color': tokenColor('--surface', 'black'),
        },
      });
      upsertLayer(map, {
        id: 'cluster-count',
        type: 'symbol',
        source: 'stores',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 12,
        },
        paint: { 'text-color': tokenColor('--accent-fg', 'black') },
      });
    }
    upsertLayer(map, {
      id: 'store-points',
      type: 'circle',
      source: 'stores',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['get', 'r'],
        'circle-color': ['get', 'color'],
        'circle-opacity': ['case', ['==', ['get', 'hollow'], 1], 0.12, 0.95],
        'circle-stroke-width': ['case', ['==', ['get', 'hollow'], 1], 2.5, 1],
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'hollow'], 1],
          ['get', 'color'],
          tokenColor('--surface', 'black'),
        ],
      },
    });
    // Frame the stores once per set of stores, so a 60 s refresh never resets the user's view.
    const signature = items.map((store) => store.id).join(',');
    if (items.length && map.__fit !== signature) {
      map.__fit = signature;
      map.fitBounds(boundsOf(items.map((store) => [store.longitude, store.latitude])), {
        padding: 48,
        maxZoom: 11,
        animate: false,
      });
    }
    if (map.__bound) return;
    map.__bound = true;
    const popup = new lib.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    map.on('mousemove', 'store-points', (event) => {
      const props = event.features?.[0]?.properties;
      if (!props) return;
      map.getCanvas().style.cursor = 'pointer';
      const card = document.createElement('div');
      const title = document.createElement('p');
      title.style.fontWeight = '600';
      title.textContent = props.name;
      const sub = document.createElement('p');
      sub.textContent = `${props.units}`;
      card.append(title, sub);
      popup.setLngLat(event.lngLat).setDOMContent(card).addTo(map);
    });
    map.on('mouseleave', 'store-points', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });
    map.on('click', 'store-points', (event) => {
      const id = event.features?.[0]?.properties?.id;
      if (id) live.current.onSelect?.(id);
    });
    if (cluster)
      map.on('click', 'clusters', async (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const zoom = await map
          .getSource('stores')
          .getClusterExpansionZoom(feature.properties.cluster_id);
        map.easeTo({ center: feature.geometry.coordinates, zoom, animate: !reducedMotion() });
      });
  }

  const points = stores.map((store) => {
    const status = statusOf(store, mode);
    return {
      id: store.id,
      longitude: store.longitude,
      latitude: store.latitude,
      radius: radiusOf(store.salesUnits ?? 0, maxUnits),
      fill: `var(${status.token})`,
      hollow: status.hollow,
      label: `${store.name}: ${t(status.key)} · ${number(store.salesUnits)} ${t('units')}`,
    };
  });
  return (
    <MapView
      label={t('storeMap')}
      setup={setup}
      dataKey={key}
      height={height}
      fallback={
        <SvgMap
          label={t('storeMap')}
          points={points}
          onPoint={onSelect}
          focus={focusOn(points)}
          tooltip={() => []}
        />
      }
    />
  );
}
