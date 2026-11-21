import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useTheme } from '../theme.js';
import {
  ALGERIA_BOUNDS,
  BOUNDARY_ATTRIBUTION,
  STYLE_URLS,
  logMapIssue,
  reducedMotion,
  tokenColor,
  webglSupported,
} from './geo.js';
import { useGeoText } from './geoMessages.js';

const BASEMAP_TIMEOUT_MS = 8000;

/** A style with no tiles at all: the boundaries still draw on a plain themed background. */
const plainStyle = () => ({
  version: 8,
  sources: {},
  layers: [
    {
      id: 'plain-background',
      type: 'background',
      paint: { 'background-color': tokenColor('--surface', 'black') },
    },
  ],
});

/** Add a GeoJSON source, or replace the data of the existing one. */
export function upsertSource(map, id, data, options = {}) {
  const existing = map.getSource(id);
  if (existing) existing.setData(data);
  else map.addSource(id, { type: 'geojson', data, ...options });
}

/** Add a layer once (setup runs again after every style change). */
export function upsertLayer(map, layer, before) {
  if (!map.getLayer(layer.id)) map.addLayer(layer, before);
}

/**
 * MapLibre GL canvas: theme-aware basemap (OpenFreeMap dark / positron), no API key, loaded lazily.
 * `setup(map, lib)` runs after every style load (add your sources and layers there; it must be
 * idempotent) and again when `dataKey` changes. If the basemap cannot load, the same layers draw on a
 * plain background and a notice says so. If WebGL is missing `fallback` renders instead.
 */
export function MapView({
  label,
  setup,
  dataKey,
  bounds = ALGERIA_BOUNDS,
  refit = false,
  height = '26rem',
  boundaries = false,
  fallback,
  className = '',
}) {
  const { t, rtl } = useGeoText();
  const { theme } = useTheme();
  const container = useRef(null);
  const state = useRef({ map: null, lib: null, setup, bounds, ready: false, plain: false });
  const [status, setStatus] = useState(() => (webglSupported() ? 'loading' : 'unsupported'));
  const [basemapFailed, setBasemapFailed] = useState(false);
  // Layout effects run before every passive effect of the commit, so setup is never stale.
  useLayoutEffect(() => {
    state.current.setup = setup;
    state.current.bounds = bounds;
  });

  // Create the map once.
  useEffect(() => {
    if (status === 'unsupported') return undefined;
    let disposed = false;
    let observer;
    let timer;
    (async () => {
      try {
        const [lib] = await Promise.all([
          import('maplibre-gl'),
          import('maplibre-gl/dist/maplibre-gl.css'),
        ]);
        if (disposed) return;
        lib.setWorkerUrl(workerUrl);
        const map = new lib.Map({
          container: container.current,
          style: STYLE_URLS[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'],
          bounds: state.current.bounds,
          fitBoundsOptions: { padding: 24, animate: false },
          attributionControl: false,
          fadeDuration: reducedMotion() ? 0 : 150,
          cooperativeGestures: false,
          locale: undefined,
        });
        const current = state.current;
        current.map = map;
        current.lib = lib;
        map.addControl(
          new lib.NavigationControl({ showCompass: false }),
          rtl ? 'top-left' : 'top-right',
        );
        map.addControl(
          new lib.AttributionControl({
            compact: false,
            customAttribution: boundaries ? BOUNDARY_ATTRIBUTION : undefined,
          }),
          rtl ? 'bottom-left' : 'bottom-right',
        );
        const fallToPlain = () => {
          if (current.plain) return;
          current.plain = true;
          setBasemapFailed(true);
          map.setStyle(plainStyle());
        };
        timer = setTimeout(() => {
          if (!current.ready) fallToPlain();
        }, BASEMAP_TIMEOUT_MS);
        map.on('style.load', () => {
          current.ready = true;
          clearTimeout(timer);
          current.setup?.(map, lib);
          setStatus('ready');
        });
        let tileErrors = 0;
        map.on('error', (event) => {
          logMapIssue('MapLibre map error', event.error ?? event);
          // A failing style or tile server must never take the choropleth down with it. One stray
          // tile is tolerated; a style that never loads, or repeated tile failures, are not.
          if (!current.ready) fallToPlain();
          else if (event?.sourceId === 'openmaptiles' && (tileErrors += 1) >= 4) fallToPlain();
        });
        observer = new ResizeObserver(() => map.resize());
        observer.observe(container.current);
      } catch (error) {
        if (disposed) return;
        logMapIssue('MapLibre initialization failed', error);
        setStatus(error?.name === 'GPUInitializationError' ? 'unsupported' : 'failed');
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer?.disconnect();
      state.current.map?.remove();
      state.current.map = null;
      state.current.ready = false;
      state.current.plain = false;
    };
    // The map lives as long as the component; theme and data have their own effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status === 'unsupported']);

  // Theme change: swap the basemap, then `style.load` re-runs setup.
  useEffect(() => {
    const { map, plain, ready } = state.current;
    if (map && ready && !plain) map.setStyle(STYLE_URLS[theme === 'light' ? 'light' : 'dark']);
    else if (map && ready && plain) map.setStyle(plainStyle());
  }, [theme]);

  // New data: let the consumer update its sources.
  useEffect(() => {
    const { map, lib, ready } = state.current;
    if (map && ready && map.isStyleLoaded()) state.current.setup?.(map, lib);
  }, [dataKey]);

  useEffect(() => {
    if (refit) state.current.map?.fitBounds(bounds, { padding: 24, animate: false });
  }, [bounds, refit]);

  if (status === 'unsupported')
    return (
      <div className={className}>
        <p role="note" className="mb-2 text-xs text-fg-3">
          {t('noWebgl')}
        </p>
        {fallback}
      </div>
    );
  return (
    <div className={'relative ' + className} style={{ height }}>
      <div
        ref={container}
        role="region"
        aria-label={label}
        className="size-full overflow-hidden rounded-lg border border-line"
      />
      {status === 'loading' && (
        <p
          role="status"
          className="absolute inset-0 grid place-items-center rounded-lg bg-surface/80 text-sm text-fg-2"
        >
          {t('loading')}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert" className="absolute inset-0 grid place-items-center text-sm text-fg-2">
          {t('mapError')}
        </p>
      )}
      {basemapFailed && (
        <p
          role="note"
          className="absolute start-2 bottom-2 max-w-[70%] rounded-md border border-warning-line bg-warning-soft px-2 py-1 text-xs text-warning"
        >
          {t('noBasemap')}
        </p>
      )}
    </div>
  );
}
