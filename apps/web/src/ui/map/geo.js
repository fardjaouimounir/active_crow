import boundaries from '../../assets/geo/dz-wilayas.json';

/** Wilaya outlines (geoBoundaries gbOpen, OpenStreetMap contributors, ODbL). Property: `code` ("01"-"48"). */
export const BOUNDARIES = boundaries;

export const ALGERIA_BOUNDS = [
  [-8.7, 18.9],
  [12.0, 37.2],
];

/** Attribution shown on every map (see docs/geo-data.md). */
export const BOUNDARY_ATTRIBUTION =
  'Boundaries © OpenStreetMap contributors (ODbL), via geoBoundaries';

export const STYLE_URLS = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
};

/** Resolved value of a design token (MapLibre paint properties cannot use var()). */
export function tokenColor(name, fallback = '') {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export const CLASSES = 5;

/**
 * Quantile class breaks: `classes - 1` thresholds that cut the sorted positive values into groups
 * of (about) equal size. Equal thresholds collapse, so a few distinct values give fewer classes.
 */
export function quantileBreaks(values, classes = CLASSES) {
  const sorted = values.filter((value) => value != null && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return [];
  const breaks = [];
  for (let step = 1; step < classes; step += 1) {
    const position = (step / classes) * (sorted.length - 1);
    const lower = Math.floor(position);
    const value =
      sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
    if (breaks.length === 0 || value > breaks[breaks.length - 1]) breaks.push(value);
  }
  return breaks;
}

/** Class 1…(breaks.length + 1) of `value`; 0 when there is nothing to colour (no data or zero). */
export function classOf(value, breaks) {
  if (value == null || !(value > 0)) return 0;
  return breaks.filter((limit) => value >= limit).length + 1;
}

/** Diverging class -2…2 of a change, relative to the largest absolute change. */
export function divergingClass(change, largest) {
  if (change == null || !largest) return 0;
  const share = change / largest;
  if (Math.abs(share) < 0.1) return 0;
  return Math.sign(share) * (Math.abs(share) < 0.5 ? 1 : 2);
}

/** Token for a sequential class (1-5) or "none". */
export const scaleToken = (klass, classes = CLASSES) =>
  klass === 0 ? '--scale-none' : `--scale-${Math.min(klass, classes)}`;

export const divergingToken = (klass) =>
  klass === 0 ? '--div-0' : `--div-${klass < 0 ? 'neg' : 'pos'}-${Math.abs(klass)}`;

/** Lower bound of each class, for the legend. */
export function legendSteps(breaks) {
  return [0, ...breaks].map((from, index) => ({
    klass: index + 1,
    from,
    to: breaks[index] ?? null,
  }));
}

/** A geodesic-ish circle (radius in metres) as a GeoJSON polygon ring around a point. */
export function circleRing(latitude, longitude, radius, steps = 72) {
  const latitudeRadians = (latitude * Math.PI) / 180;
  const metresPerDegreeLatitude = 111_320;
  const metresPerDegreeLongitude = 111_320 * Math.cos(latitudeRadians);
  const ring = Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * 2 * Math.PI;
    return [
      longitude + (Math.cos(angle) * radius) / metresPerDegreeLongitude,
      latitude + (Math.sin(angle) * radius) / metresPerDegreeLatitude,
    ];
  });
  return [...ring, ring[0]];
}

function walk(coordinates, visit) {
  if (typeof coordinates[0] === 'number') visit(coordinates);
  else for (const part of coordinates) walk(part, visit);
}

/** [[west, south], [east, north]] of any GeoJSON coordinates (or a list of [lon, lat] points). */
export function boundsOf(coordinates) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  walk(coordinates, ([lon, lat]) => {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  });
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * Projector from [lon, lat] to SVG pixels for `bounds`, fitted in width x height with padding.
 * Longitude is scaled by cos(latitude) so shapes keep their proportions.
 */
export function makeProjector(bounds, width, height, padding = 8) {
  const [[west, south], [east, north]] = bounds;
  const k = Math.cos((((south + north) / 2) * Math.PI) / 180);
  const spanX = Math.max((east - west) * k, 1e-9);
  const spanY = Math.max(north - south, 1e-9);
  const scale = Math.min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return ([lon, lat]) => [offsetX + (lon - west) * k * scale, offsetY + (north - lat) * scale];
}

/** SVG path data of a Polygon / MultiPolygon geometry. */
export function geometryPath(geometry, project) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .flatMap((rings) =>
      rings.map(
        (ring) =>
          ring
            .map((point, index) => {
              const [x, y] = project(point);
              return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join('') + 'Z',
      ),
    )
    .join('');
}

/** True when this browser can create a WebGL context (MapLibre needs it). */
export function webglSupported() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext?.('webgl2') ?? canvas.getContext?.('webgl'));
  } catch {
    return false;
  }
}

export const reducedMotion = () =>
  typeof window !== 'undefined' &&
  Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
