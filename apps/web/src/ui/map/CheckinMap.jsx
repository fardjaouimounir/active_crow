import { haversineMeters } from '@fieldflow/shared';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { boundsOf, circleRing, makeProjector, tokenColor } from './geo.js';
import { useGeoText } from './geoMessages.js';
import { MapView, upsertLayer, upsertSource } from './MapView.jsx';

const SIZE = 280;

/**
 * Mini-map of one attendance proof: the store, the check-in point, the allowed radius
 * (`maxDistanceMeters` of the attendance rule) and the line between them. Only this single
 * check-in point is shown, never a trail or anyone's live position.
 */
export function CheckinMap({ store, checkin, radius, distance }) {
  const { t, number } = useGeoText();
  const live = useRef({});
  const hasStore = store?.latitude != null && store?.longitude != null;
  const hasCheckin = checkin?.latitude != null && checkin?.longitude != null;
  const metres =
    distance ?? (hasStore && hasCheckin ? Math.round(haversineMeters(store, checkin)) : null);
  const outside = radius != null && metres != null && metres > radius;
  useLayoutEffect(() => {
    live.current = { store, checkin, radius, outside };
  });

  const ring = useMemo(
    () => (hasStore && radius ? circleRing(store.latitude, store.longitude, radius) : null),
    [hasStore, store, radius],
  );
  const key = useMemo(() => ({ store, checkin, radius }), [store, checkin, radius]);

  function setup(map) {
    const { store: place, checkin: point } = live.current;
    const here = [place.longitude, place.latitude];
    const features = [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: here },
        properties: { kind: 'store' },
      },
    ];
    if (point?.latitude != null)
      features.push(
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
          properties: { kind: 'checkin' },
        },
        {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [here, [point.longitude, point.latitude]] },
          properties: { kind: 'line' },
        },
      );
    if (ring)
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: { kind: 'radius' },
      });
    upsertSource(map, 'checkin', { type: 'FeatureCollection', features });
    const accent = tokenColor('--accent', 'green');
    upsertLayer(map, {
      id: 'checkin-radius',
      type: 'fill',
      source: 'checkin',
      filter: ['==', ['get', 'kind'], 'radius'],
      paint: { 'fill-color': accent, 'fill-opacity': 0.15 },
    });
    upsertLayer(map, {
      id: 'checkin-radius-line',
      type: 'line',
      source: 'checkin',
      filter: ['==', ['get', 'kind'], 'radius'],
      paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 2] },
    });
    upsertLayer(map, {
      id: 'checkin-line',
      type: 'line',
      source: 'checkin',
      filter: ['==', ['get', 'kind'], 'line'],
      paint: { 'line-color': tokenColor('--fg-2', 'gray'), 'line-width': 1.5 },
    });
    upsertLayer(map, {
      id: 'checkin-points',
      type: 'circle',
      source: 'checkin',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 7,
        'circle-color': [
          'case',
          ['==', ['get', 'kind'], 'store'],
          tokenColor('--info', 'blue'),
          live.current.outside ? tokenColor('--danger', 'red') : tokenColor('--success', 'green'),
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': tokenColor('--surface', 'black'),
      },
    });
    const coordinates = [
      here,
      ...(point?.latitude != null ? [[point.longitude, point.latitude]] : []),
      ...(ring ?? []),
    ];
    map.fitBounds(boundsOf(coordinates), { padding: 28, maxZoom: 17, animate: false });
  }

  if (!hasStore) return <p className="text-sm text-fg-3">{t('noStoreLocation')}</p>;
  return (
    <figure className="m-0 space-y-1.5">
      <MapView
        label={t('checkinMap')}
        setup={setup}
        dataKey={key}
        bounds={[
          [store.longitude - 0.01, store.latitude - 0.01],
          [store.longitude + 0.01, store.latitude + 0.01],
        ]}
        height="16rem"
        fallback={
          <PlainCheckin
            store={store}
            checkin={hasCheckin ? checkin : null}
            radius={radius}
            outside={outside}
          />
        }
      />
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full"
            style={{ background: 'var(--info)' }}
          />
          {t('storePoint')}
        </span>
        {hasCheckin && (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: outside ? 'var(--danger)' : 'var(--success)' }}
            />
            {t('checkinPoint')}
          </span>
        )}
        {radius != null && (
          <span className="tnum">{t('allowedRadius', { meters: number(radius) })}</span>
        )}
        {metres != null && (
          <span className={'tnum font-medium ' + (outside ? 'text-danger' : 'text-fg')}>
            {t('distance', { meters: number(metres) })}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The same picture in plain SVG (metres around the store) when WebGL is unavailable. */
function PlainCheckin({ store, checkin, radius, outside }) {
  const { t } = useGeoText();
  const metresPerDegreeLatitude = 111_320;
  const metresPerDegreeLongitude =
    metresPerDegreeLatitude * Math.cos((store.latitude * Math.PI) / 180);
  const toMetres = (point) => [
    (point.longitude - store.longitude) * metresPerDegreeLongitude,
    (point.latitude - store.latitude) * metresPerDegreeLatitude,
  ];
  const checkinMetres = checkin ? toMetres(checkin) : null;
  const extent =
    Math.max(radius ?? 0, ...(checkinMetres ? checkinMetres.map(Math.abs) : [0]), 60) * 1.25;
  const project = makeProjector(
    [
      [-extent, -extent],
      [extent, extent],
    ],
    SIZE,
    SIZE,
    6,
  );
  const [cx, cy] = project([0, 0]);
  const pixelsPerMetre = project([1, 0])[0] - cx;
  const point = checkinMetres ? project(checkinMetres) : null;
  return (
    <svg
      role="img"
      aria-label={t('checkinMap')}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      dir="ltr"
      className="mx-auto h-64 w-full max-w-sm rounded-lg border border-line bg-surface"
    >
      {radius != null && (
        <circle
          cx={cx}
          cy={cy}
          r={radius * pixelsPerMetre}
          fill="var(--accent)"
          fillOpacity="0.15"
          stroke="var(--accent-text)"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />
      )}
      {point && (
        <line x1={cx} y1={cy} x2={point[0]} y2={point[1]} stroke="var(--fg-2)" strokeWidth="1.5" />
      )}
      <circle cx={cx} cy={cy} r="6" fill="var(--info)" stroke="var(--surface)" strokeWidth="2" />
      {point && (
        <circle
          cx={point[0]}
          cy={point[1]}
          r="6"
          fill={outside ? 'var(--danger)' : 'var(--success)'}
          stroke="var(--surface)"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}
