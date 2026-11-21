import { ROLE_PERMISSIONS, calculateKpis, haversineMeters } from '@fieldflow/shared';
import { WILAYA_POLYGON } from '@fieldflow/shared/wilayaPolygons';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests } from '../src/shared/auth/session.js';
import i18n from '../src/shared/i18n/index.js';
import { CheckinMap } from '../src/ui/map/CheckinMap.jsx';
import { HeatmapGrid } from '../src/ui/map/HeatmapGrid.jsx';
import {
  BOUNDARIES,
  circleRing,
  classOf,
  divergingClass,
  makeProjector,
  quantileBreaks,
  choroplethClasses,
} from '../src/ui/map/geo.js';
import { makeUser, mockApi, sessionFor } from './helpers/mockApi.js';
import { renderApp } from './helpers/renderApp.jsx';

if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
}

describe('scales and geometry', () => {
  it('cuts values into five quantile classes and leaves zero and missing values out', () => {
    const breaks = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, null]);
    expect(breaks).toHaveLength(4);
    expect(breaks).toEqual([...breaks].sort((a, b) => a - b));
    expect([1, 3, 5, 7, 10].map((value) => classOf(value, breaks))).toEqual([1, 2, 3, 4, 5]);
    expect(classOf(0, breaks)).toBe(0);
    expect(classOf(null, breaks)).toBe(0);
    // Few distinct values collapse into fewer classes instead of empty ones.
    expect(quantileBreaks([5, 5, 5, 5])).toHaveLength(1);
    expect(quantileBreaks([])).toEqual([]);
  });

  it('classifies a change on a diverging scale around zero', () => {
    expect(divergingClass(0, 10)).toBe(0);
    expect(divergingClass(0.5, 10)).toBe(0);
    expect(divergingClass(3, 10)).toBe(1);
    expect(divergingClass(-9, 10)).toBe(-2);
    expect(divergingClass(5, 0)).toBe(0);
  });

  it('draws the allowed radius as a ring of that many metres', () => {
    const ring = circleRing(36.75, 3.06, 250);
    for (const [longitude, latitude] of ring)
      expect(
        haversineMeters({ latitude: 36.75, longitude: 3.06 }, { latitude, longitude }),
      ).toBeCloseTo(250, -1);
    expect(ring[0]).toEqual(ring.at(-1));
  });

  it('keeps every wilaya polygon of the boundary file mapped and inside the frame', () => {
    const project = makeProjector(
      [
        [-8.7, 18.9],
        [12, 37.2],
      ],
      640,
      520,
    );
    expect(BOUNDARIES.features).toHaveLength(48);
    const [x, y] = project([3.06, 36.75]);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(640);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(520);
    expect(new Set(Object.values(WILAYA_POLYGON)).size).toBe(48);
  });
});

const period = { from: '2026-11-14', to: '2026-11-20' };

it('uses exact classes for sparse choropleth data including zero', () => {
  const scale = choroplethClasses([0, 0.78, null, 0.79, 0.79]);
  expect(scale.steps.map(({ value }) => value)).toEqual([0, 0.78, 0.79]);
  expect(new Set([0, 0.78, 0.79].map(scale.classify)).size).toBe(3);
});
const wilayaNames = [
  { id: 1, nameEn: 'Adrar', nameAr: 'أدرار' },
  { id: 16, nameEn: 'Algiers', nameAr: 'الجزائر' },
  { id: 49, nameEn: 'Timimoun', nameAr: 'تيميمون' },
  { id: 50, nameEn: 'Bordj Badji Mokhtar', nameAr: 'برج باجي مختار' },
];
const kpiBundle = (units) => ({
  salesUnits: units,
  buyers: units - 1,
  conversionRate: 0.4,
  attendanceRate: 0.9,
  giftDistributionRate: 0.8,
  storeCoverage: 0.5,
  undeliveredUnits: 2,
});
const polygons = [
  {
    polygonCode: '16',
    wilayaIds: [16],
    members: [wilayaNames[1]],
    included: [],
    value: 12,
    rank: 1,
    kpis: kpiBundle(12),
  },
  {
    polygonCode: '01',
    wilayaIds: [1, 49, 50],
    members: [wilayaNames[0], wilayaNames[2], wilayaNames[3]],
    included: [wilayaNames[2], wilayaNames[3]],
    value: 8,
    rank: 2,
    kpis: kpiBundle(8),
  },
];
const stores = [
  {
    id: 'store-1',
    name: 'Ardis Hydra',
    code: 'P-17',
    wilaya: wilayaNames[1],
    latitude: 36.75,
    longitude: 3.06,
    salesUnits: 12,
    buyers: 10,
    attendanceRate: 0.9,
    lastVisit: '2026-11-19',
    openIssues: 1,
    today: { animateurs: 2, present: 1, late: 0, notSent: 1, absent: 0, campaignIds: ['c-1'] },
  },
  {
    id: 'store-2',
    name: 'Uno Timimoun',
    code: 'P-49',
    wilaya: wilayaNames[2],
    latitude: 29.26,
    longitude: 0.23,
    salesUnits: 8,
    buyers: 7,
    attendanceRate: 0.4,
    lastVisit: null,
    openIssues: 0,
    today: null,
  },
];
const unlocated = [
  { ...stores[0], id: 'store-3', name: 'Shop without GPS', latitude: null, longitude: null },
];
const heat = (value) => ({
  kind: 'sales',
  period,
  matrix: Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => (day === 0 && hour === 23 ? value : 0)),
  ),
  total: value,
  max: value,
});
const ok = (data, meta) => [200, { data, ...(meta ? { meta } : {}) }];
let api;

function stub(role, extra = {}) {
  const user = makeUser({ role });
  const stats = calculateKpis(period, {
    salesUnits: 20,
    salesCount: 6,
    verified: 2,
    expectedSlots: 4,
  });
  api = mockApi({
    'POST /auth/refresh': () => [200, sessionFor(user)],
    'GET /auth/me': () => ok({ user, permissions: ROLE_PERMISSIONS[role] }),
    'GET /notifications/unread-count': () => ok({ count: 0 }),
    'GET /reference/wilayas': () => ok(wilayaNames),
    'GET /reports/kpis': () =>
      ok({ ...stats, alerts: { oldPending: 0, unvisitedStores: 0 }, options: {} }),
    'GET /reports/breakdown': () => ok([]),
    'GET /reports/geo/wilayas': ({ params }) =>
      ok({
        metric: params.metric,
        period,
        total: { value: 20, kpis: kpiBundle(20) },
        wilayas: [],
        polygons,
      }),
    'GET /reports/geo/stores': () => ok({ period, stores, unlocated }),
    'GET /reports/heatmap': ({ params }) => ok({ ...heat(5), kind: params.kind }),
    ...extra,
  });
}

beforeEach(() => localStorage.clear());
afterEach(async () => {
  api?.restore();
  resetSessionForTests();
  vi.restoreAllMocks();
  await i18n.changeLanguage('en');
});

describe('dashboard geography', () => {
  it('clicking a wilaya filters the whole dashboard through the URL, and the chip resets it', async () => {
    stub('director');
    const user = userEvent.setup();
    const view = renderApp('/app/dashboard');
    await screen.findByRole('heading', { name: 'Geography' });
    const map = await screen.findByRole('group', { name: 'Map of Algeria by wilaya' });
    // Tooltip content on focus: value, rank, KPIs and the wilayas drawn inside the polygon.
    const adrar = await within(map).findByRole('button', { name: /Adrar/ });
    expect(adrar).toHaveAccessibleName(/Includes: Timimoun, Bordj Badji Mokhtar/);
    adrar.focus();
    const card = await screen.findByText('Rank 2 of 2');
    expect(card.closest('figcaption')).toHaveTextContent('Units sold: 8');
    await user.click(adrar);
    await waitFor(() => expect(view.location()).toBe('/app/dashboard?wilayaIds=1%2C49%2C50'));
    // The filter reaches every dashboard request, and the map keeps all wilayas for context.
    await waitFor(() =>
      expect(api.calls.filter(({ key }) => key === 'GET /reports/kpis').length).toBeGreaterThan(1),
    );
    const reset = await screen.findByRole('button', {
      name: /Filtered to Adrar, Timimoun, Bordj Badji Mokhtar/,
    });
    expect(within(map).getByRole('button', { name: /Algiers/ })).toBeInTheDocument();
    await user.click(reset);
    await waitFor(() => expect(view.location()).toBe('/app/dashboard'));
    // Keyboard path: the ranked side list selects a wilaya as well.
    await user.click(screen.getAllByRole('button', { name: /Algiers/ }).at(-1));
    await waitFor(() => expect(view.location()).toBe('/app/dashboard?wilayaIds=16'));
  }, 20_000);

  it('shows the legend with the period and switches metric and the change scale', async () => {
    stub('director');
    const user = userEvent.setup();
    renderApp('/app/dashboard');
    await screen.findByRole('group', { name: 'Map of Algeria by wilaya' });
    const legend = screen.getByText('Units sold', { selector: 'p.font-medium' });
    expect(legend).toHaveTextContent('2026');
    await user.selectOptions(screen.getByLabelText('Metric'), 'conversion_rate');
    await waitFor(() =>
      expect(api.calls.some(({ key }) => key === 'GET /reports/geo/wilayas')).toBe(true),
    );
    await user.click(screen.getByLabelText('Change vs previous period'));
    await waitFor(() =>
      expect(
        api.calls.filter(({ key }) => key === 'GET /reports/geo/wilayas').length,
      ).toBeGreaterThan(2),
    );
    expect(
      screen.getByText('Change vs previous period', { selector: 'p.font-medium' }),
    ).toBeInTheDocument();
  }, 20_000);

  it('notes that the interactive map is unavailable and still renders the SVG choropleth (no WebGL)', async () => {
    stub('director');
    renderApp('/app/dashboard');
    expect(
      await screen.findByText(/Interactive map is unavailable in this browser/),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('group', { name: 'Map of Algeria by wilaya' }),
    ).toBeInTheDocument();
  }, 20_000);

  it('lists stores, keeps unlocated ones apart and opens a store drawer', async () => {
    stub('director');
    const user = userEvent.setup();
    renderApp('/app/dashboard');
    await user.click(await screen.findByRole('tab', { name: 'Stores' }));
    const map = await screen.findByRole('group', { name: 'Store map' });
    expect(within(map).getAllByRole('button')).toHaveLength(2);
    expect(await screen.findByText('Stores without coordinates (1)')).toBeInTheDocument();
    expect(within(map).queryByRole('button', { name: /Shop without GPS/ })).toBeNull();
    // Legend counts follow the colour mode.
    expect(screen.getByLabelText('Visited in the last 7 days')).toHaveTextContent('Visited 1');
    await user.selectOptions(screen.getByLabelText('Colour by'), 'issues');
    expect(screen.getByLabelText('Open issues')).toHaveTextContent('Open issues 1');
    await user.click(within(map).getByRole('button', { name: /Ardis Hydra/ }));
    const drawer = within(await screen.findByRole('dialog'));
    expect(drawer.getByText('Last visit').nextSibling).toHaveTextContent('Nov 2026');
    expect(drawer.getByRole('link', { name: 'Open store' })).toHaveAttribute(
      'href',
      '/app/points-of-sale/store-1',
    );
  }, 20_000);

  it('shows weekday by hour heatmaps with a table twin', async () => {
    stub('director');
    const user = userEvent.setup();
    renderApp('/app/dashboard');
    await user.click(await screen.findByRole('tab', { name: 'Timing' }));
    expect(
      await screen.findByRole('img', { name: /Sales by weekday and hour/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Late check-ins by weekday and hour/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('View as table')).toHaveLength(2);
  }, 20_000);
});

describe('live field map', () => {
  it("shows a supervisor today's attendance per store, refreshes every minute and opens the board", async () => {
    stub('supervisor');
    const user = userEvent.setup();
    const view = renderApp('/app/dashboard');
    const section = (await screen.findByRole('heading', { name: 'Today in the field' })).closest(
      'section',
    );
    // Only stores with someone scheduled today; counts come from the API.
    const totals = within(section.querySelector('dl'));
    expect(totals.getByText('Present').nextSibling).toHaveTextContent('1');
    expect(totals.getByText('Not sent').nextSibling).toHaveTextContent('1');
    expect(within(section).queryByText(/Uno Timimoun/)).toBeNull();
    await user.click(
      within(section)
        .getAllByRole('button', { name: /Ardis Hydra/ })
        .at(-1),
    );
    await waitFor(() =>
      expect(view.location()).toBe('/app/campaigns/c-1?tab=attendance&store=store-1'),
    );
    expect(screen.queryByRole('heading', { name: 'Geography' })).toBeNull();
  }, 20_000);
});

describe('heatmap grid', () => {
  const matrix = heat(4).matrix;

  it('starts the hour axis at the left edge in Arabic and English', async () => {
    const x = (container, day, hour) =>
      Number(
        container.querySelector(`rect[aria-label][x]`) &&
          [...container.querySelectorAll('rect')][day * 24 + hour].getAttribute('x'),
      );
    const { container, unmount } = render(
      <HeatmapGrid matrix={matrix} kind="sales" title="Sales" />,
    );
    expect(x(container, 0, 0)).toBeLessThan(x(container, 0, 23));
    unmount();
    await i18n.changeLanguage('ar');
    const rtl = render(<HeatmapGrid matrix={matrix} kind="sales" title="المبيعات" />);
    expect(x(rtl.container, 0, 0)).toBeLessThan(x(rtl.container, 0, 23));
    expect({
      cells: rtl.container.querySelectorAll('rect').length,
      focusable: rtl.container.querySelectorAll('rect[tabindex]').length,
      tableRows: rtl.container.querySelectorAll('tbody tr').length,
      tableColumns: rtl.container.querySelectorAll('thead th').length,
    }).toEqual({ cells: 168, focusable: 0, tableRows: 7, tableColumns: 25 });
    expect(rtl.container.querySelector('rect[aria-label]').getAttribute('aria-label')).toContain(
      '4',
    );
    // Weekday labels sit outside the grid on the reading-start side: the right in Arabic.
    const xs = [...rtl.container.querySelectorAll('rect')].map((rect) =>
      Number(rect.getAttribute('x')),
    );
    const labelX = Number(rtl.container.querySelector('svg text:last-of-type').getAttribute('x'));
    expect(labelX).toBeGreaterThan(Math.max(...xs) + 20);
  });

  it('says so when there is no activity', () => {
    render(<HeatmapGrid matrix={heat(0).matrix} kind="sales" title="Sales" />);
    expect(screen.getByText('No activity in this period.')).toBeInTheDocument();
  });
});

describe('check-in mini-map', () => {
  const store = { name: 'Ardis Hydra', latitude: 36.75, longitude: 3.06 };

  it('draws the store, the check-in point and a radius taken from the rule', () => {
    const { container } = render(
      <CheckinMap
        store={store}
        checkin={{ latitude: 36.7515, longitude: 3.06 }}
        radius={200}
        distance={167}
      />,
    );
    expect(screen.getByText('Allowed radius: 200 m')).toBeInTheDocument();
    expect(screen.getByText('Distance: 167 m')).toBeInTheDocument();
    const svg = container.querySelector('svg');
    const [ring, storeDot, checkinDot] = svg.querySelectorAll('circle');
    const line = svg.querySelector('line');
    const length = Math.hypot(
      Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
      Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')),
    );
    // 200 m of radius against 167 m of distance: the check-in dot sits inside the ring.
    expect(Number(ring.getAttribute('r'))).toBeGreaterThan(length);
    expect(storeDot).toBeDefined();
    expect(checkinDot.getAttribute('fill')).toBe('var(--success)');
  });

  it('marks a check-in outside the allowed radius', () => {
    const { container } = render(
      <CheckinMap
        store={store}
        checkin={{ latitude: 36.754, longitude: 3.06 }}
        radius={100}
        distance={444}
      />,
    );
    const [ring, , checkinDot] = container.querySelectorAll('svg circle');
    const line = container.querySelector('svg line');
    const length = Math.hypot(
      Number(line.getAttribute('x2')) - Number(line.getAttribute('x1')),
      Number(line.getAttribute('y2')) - Number(line.getAttribute('y1')),
    );
    expect(Number(ring.getAttribute('r'))).toBeLessThan(length);
    expect(checkinDot.getAttribute('fill')).toBe('var(--danger)');
    expect(screen.getByText('Distance: 444 m')).toHaveClass('text-danger');
  });

  it('does not invent a location for a store without coordinates', () => {
    render(
      <CheckinMap
        store={{ name: 'X', latitude: null, longitude: null }}
        checkin={{ latitude: 1, longitude: 1 }}
        radius={100}
      />,
    );
    expect(screen.getByText('The store has no location.')).toBeInTheDocument();
  });
});

describe('client portal geography', () => {
  const campaignId = '33333333-3333-4333-8333-333333333333';
  const campaign = {
    id: campaignId,
    code: 'CMP-1',
    name: 'Ramadan 2026',
    status: 'active',
    startDate: '2026-11-01T00:00:00.000Z',
    endDate: '2026-11-30T00:00:00.000Z',
    provisional: true,
    client: { id: 'c1', name: 'Client X' },
    wilayas: [],
    period,
    kpis: calculateKpis(period, { salesUnits: 20 }),
    tombolas: [],
    commentary: null,
    headline: {
      units: 20,
      buyers: 10,
      distributedUnits: 5,
      completionRate: 0.2,
      targetAchievement: null,
    },
  };

  it('shows maps from client endpoints only, with no staff data', async () => {
    const user = makeUser({ role: 'client', clientId: 'c1' });
    const redacted = (kpis) => ({
      salesUnits: kpis.salesUnits,
      buyers: kpis.buyers,
      conversionRate: 0.4,
      giftDistributionRate: 0.8,
    });
    api = mockApi({
      'POST /auth/refresh': () => [200, sessionFor(user)],
      'GET /auth/me': () => ok({ user, permissions: ROLE_PERMISSIONS.client }),
      'GET /notifications/unread-count': () => ok({ count: 0 }),
      'GET /reference/wilayas': () => ok(wilayaNames),
      'GET /portal/campaigns': () => ok([campaign]),
      [`GET /portal/campaigns/${campaignId}`]: () => ok(campaign),
      [`GET /portal/campaigns/${campaignId}/breakdown`]: () => ok([]),
      [`GET /portal/campaigns/${campaignId}/proof`]: () => ok([]),
      [`GET /portal/campaigns/${campaignId}/documents`]: () => ok([]),
      [`GET /portal/campaigns/${campaignId}/geo/wilayas`]: () =>
        ok({
          metric: 'sales_units',
          period,
          total: { value: 20, kpis: redacted(kpiBundle(20)) },
          wilayas: [],
          polygons: polygons.map((row) => ({ ...row, kpis: redacted(row.kpis) })),
        }),
      [`GET /portal/campaigns/${campaignId}/geo/stores`]: () =>
        ok({
          stores: stores.map(({ id, name, wilaya, latitude, longitude, salesUnits, buyers }) => ({
            id,
            name,
            wilaya,
            latitude,
            longitude,
            salesUnits,
            buyers,
          })),
          unlocated: [],
        }),
    });
    renderApp(`/portal/campaigns/${campaignId}`);
    const section = (await screen.findByRole('heading', { name: 'Geography' })).closest('section');
    const metric = await within(section).findByLabelText('Metric');
    expect(
      within(metric)
        .getAllByRole('option')
        .map((option) => option.value),
    ).toEqual(['sales_units', 'buyers', 'conversion_rate', 'gift_distribution_rate']);
    expect(await within(section).findByText(/Ardis Hydra · Algiers/)).toBeInTheDocument();
    expect(section).not.toHaveTextContent(/attendance|visit|issue/i);
    for (const { key } of api.calls) {
      expect(
        key.startsWith('GET /portal/') ||
          key.startsWith('GET /reference/') ||
          key.startsWith('GET /auth') ||
          key.startsWith('GET /notifications') ||
          key.startsWith('POST /auth'),
      ).toBe(true);
    }
  }, 20_000);
});

describe('basemap failure', () => {
  it('keeps the choropleth layers and says the basemap is missing when tiles are blocked', async () => {
    // A fake MapLibre whose style never loads (tiles blocked), then loads the plain style.
    const layers = new Set();
    const handlers = {};
    class FakeMap {
      constructor() {
        queueMicrotask(() => handlers.error?.({ error: new Error('blocked') }));
      }
      on(event, layerOrHandler, handler) {
        if (typeof layerOrHandler === 'function') handlers[event] = layerOrHandler;
        else handlers[`${event}:${layerOrHandler}`] = handler;
      }
      addControl() {}
      setStyle() {
        queueMicrotask(() => handlers['style.load']?.());
      }
      resize() {}
      remove() {}
      isStyleLoaded() {
        return true;
      }
      getSource() {
        return null;
      }
      addSource() {}
      getLayer(id) {
        return layers.has(id) ? {} : undefined;
      }
      addLayer(layer) {
        layers.add(layer.id);
      }
      getCanvas() {
        return { style: {} };
      }
    }
    vi.doMock('maplibre-gl', () => ({
      Map: FakeMap,
      NavigationControl: class {},
      AttributionControl: class {},
      Popup: class {},
      setWorkerUrl: vi.fn(),
    }));
    vi.doMock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
    HTMLCanvasElement.prototype.getContext = () => ({});
    try {
      stub('director');
      renderApp('/app/dashboard');
      expect(
        await screen.findByText('The basemap could not be loaded. Showing wilaya boundaries only.'),
      ).toBeInTheDocument();
      await waitFor(() => expect(layers.has('wilaya-fill')).toBe(true));
      expect(layers.has('wilaya-line')).toBe(true);
    } finally {
      HTMLCanvasElement.prototype.getContext = () => null;
      vi.doUnmock('maplibre-gl');
      vi.doUnmock('maplibre-gl/dist/maplibre-gl.css');
    }
  }, 30_000);
});

describe('geography in Arabic', () => {
  it('renders the section right to left with Arabic labels and no physical-direction utilities', async () => {
    await i18n.changeLanguage('ar');
    stub('director');
    renderApp('/app/dashboard');
    const heading = await screen.findByRole('heading', { name: 'الجغرافيا' });
    const section = heading.closest('section');
    await within(section).findByRole('group', { name: 'خريطة الجزائر حسب الولاية' });
    expect({
      dir: document.documentElement.dir,
      tabs: within(section)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
      legend: within(section).getAllByText('الوحدات المباعة', { selector: 'p.font-medium' }).length,
      physical: /\b(?:ml|mr|pl|pr)-\d|\b(?:left|right)-\d|\btext-(?:left|right)\b/.test(
        section.innerHTML,
      ),
    }).toEqual({
      dir: 'rtl',
      tabs: ['الولايات', 'نقاط البيع', 'التوقيت'],
      legend: 1,
      physical: false,
    });
  }, 20_000);
});
