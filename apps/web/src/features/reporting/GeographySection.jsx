import { today } from '@fieldflow/shared';
import { GEO_METRICS, RATIO_GEO_METRICS } from '@fieldflow/shared/wilayaPolygons';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCan } from '../../shared/auth/hooks.js';
import { TabStrip } from '../../ui/data.jsx';
import { Drawer } from '../../ui/overlays.jsx';
import { Skeleton, buttonClass, controlClass, cn } from '../../ui/primitives.jsx';
import {
  ChoroplethLegend,
  ChoroplethMap,
  useChoroplethModel,
  wilayasOfPolygon,
} from '../../ui/map/ChoroplethMap.jsx';
import { COLOR_MODES, StoreLegend, StoreMap, statusOf } from '../../ui/map/StoreMap.jsx';
import { useGeoText } from '../../ui/map/geoMessages.js';
import { useReport } from './api.js';
import { useWilayaName } from './useWilayaName.js';

// MapLibre itself (inside MapView) loads only when a map with WebGL is on screen, never in /field.
const HeatmapGrid = lazy(() =>
  import('../../ui/map/HeatmapGrid.jsx').then((module) => ({ default: module.HeatmapGrid })),
);

const DAY = 86_400_000;
const shift = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);

const MapFallback = ({ height = '28rem' }) => <Skeleton className="w-full" style={{ height }} />;

function StoreDrawer({ store, onClose }) {
  const { t, number, percent, date, name } = useGeoText();
  const canOpen = useCan('org.pos.read');
  return (
    <Drawer title={store.name} onClose={onClose}>
      <dl className="grid gap-2.5 text-sm">
        {[
          [t('wilayas'), name(store.wilaya)],
          [
            t('sales'),
            `${number(store.salesUnits)} ${t('units')} · ${number(store.buyers)} ${t('buyersCount')}`,
          ],
          [t('attendanceRate'), percent(store.attendanceRate)],
          [t('lastVisit'), store.lastVisit ? date(store.lastVisit) : t('never')],
          [t('openIssues'), number(store.openIssues)],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-line pb-2">
            <dt className="text-fg-2">{label}</dt>
            <dd className="tnum text-end font-medium">{value}</dd>
          </div>
        ))}
        {store.today && (
          <div className="space-y-1">
            <dt className="text-fg-2">{t('colorBy.today')}</dt>
            <dd className="tnum flex flex-wrap gap-x-4 gap-y-1 font-medium">
              {['present', 'late', 'notSent', 'absent'].map((key) => (
                <span key={key}>
                  {t(key)} {number(store.today[key])}
                </span>
              ))}
            </dd>
          </div>
        )}
      </dl>
      {canOpen && (
        <Link
          to={`/app/points-of-sale/${store.id}`}
          className={buttonClass({ variant: 'secondary', className: 'mt-4' })}
        >
          {t('openStore')}
        </Link>
      )}
    </Drawer>
  );
}

function UnlocatedList({ stores }) {
  const { t } = useGeoText();
  if (!stores.length) return null;
  return (
    <details className="rounded-lg border border-line p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {t('unlocated', { count: stores.length })}
      </summary>
      <p className="mt-2 text-xs text-fg-3">{t('unlocatedHint')}</p>
      <ul className="mt-2 grid gap-1 sm:grid-cols-2">
        {stores.map((store) => (
          <li key={store.id} className="truncate">
            {store.name}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Store points with a colour mode, a sales density heatmap, clusters and a store drawer. */
export function StoreMapPanel({ filters, enabled = true, heightRem = '28rem' }) {
  const { t, number } = useGeoText();
  const query = useReport('/geo/stores', filters, enabled);
  const [mode, setMode] = useState('visit');
  const [heat, setHeat] = useState(false);
  const [selected, setSelected] = useState(null);
  const stores = query.data?.stores ?? [];
  const store = stores.find((item) => item.id === selected);
  if (query.isPending) return <MapFallback height={heightRem} />;
  if (query.isError) return <p role="alert">{t('error')}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-fg-3">
          {t('colorBy')}
          <select
            className={controlClass + ' w-56'}
            value={mode}
            onChange={(event) => setMode(event.target.value)}
          >
            {COLOR_MODES.map((value) => (
              <option key={value} value={value}>
                {t('colorBy.' + value)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={heat}
            onChange={(event) => setHeat(event.target.checked)}
          />
          {t('heat')}
        </label>
        <p className="tnum ms-auto text-xs text-fg-3">
          {number(stores.length)} {t('stores').toLowerCase()}
        </p>
      </div>
      {stores.length ? (
        <Suspense fallback={<MapFallback height={heightRem} />}>
          <StoreMap
            stores={stores}
            mode={mode}
            heat={heat}
            onSelect={setSelected}
            height={heightRem}
          />
        </Suspense>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-fg-2">
          {t('noStores')}
        </p>
      )}
      <StoreLegend stores={stores} mode={mode} />
      <UnlocatedList stores={query.data.unlocated} />
      {store && <StoreDrawer store={store} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Today's attendance per store for supervisors and regional managers; refreshes every minute. */
export function LiveFieldSection({ filters }) {
  const { t, number } = useGeoText();
  const navigate = useNavigate();
  // Today only: the dashboard period must not hide the stores that work today.
  const now = today();
  const live = { ...filters, from: now, to: now };
  const query = useReport('/geo/stores', live, true, { refetchInterval: 60_000 });
  const stores = (query.data?.stores ?? []).filter((store) => store.today?.animateurs);
  const totals = stores.reduce(
    (sum, store) => {
      for (const key of ['present', 'late', 'notSent', 'absent']) sum[key] += store.today[key];
      return sum;
    },
    { present: 0, late: 0, notSent: 0, absent: 0 },
  );
  const open = (id) => {
    const store = stores.find((item) => item.id === id);
    const campaign = store?.today?.campaignIds?.[0];
    if (campaign) navigate(`/app/campaigns/${campaign}?tab=attendance&store=${id}`);
  };
  if (query.isPending) return <MapFallback height="22rem" />;
  if (query.isError) return <p role="alert">{t('error')}</p>;
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold tracking-tight">{t('live')}</h2>
        <p className="text-xs text-fg-3">{t('liveHint')}</p>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {['present', 'late', 'notSent', 'absent'].map((key) => (
          <div key={key} className="flex items-baseline gap-1.5">
            <dt className="text-fg-2">{t(key)}</dt>
            <dd className="tnum text-lg font-semibold">{number(totals[key])}</dd>
          </div>
        ))}
      </dl>
      {stores.length ? (
        <Suspense fallback={<MapFallback height="22rem" />}>
          <StoreMap stores={stores} mode="today" cluster={false} onSelect={open} height="22rem" />
        </Suspense>
      ) : (
        <p className="text-sm text-fg-2">{t('noToday')}</p>
      )}
      <StoreLegend stores={stores} mode="today" />
      <ul className="grid gap-1 text-sm sm:grid-cols-2">
        {stores.map((store) => {
          const status = statusOf(store, 'today');
          return (
            <li key={store.id}>
              <button
                type="button"
                onClick={() => open(store.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-sunken"
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-3 shrink-0 rounded-full border-2"
                  style={{
                    borderColor: `var(${status.token})`,
                    background: status.hollow ? 'transparent' : `var(${status.token})`,
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{store.name}</span>
                <span className="text-xs text-fg-3">{t(status.key)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function WilayaPanel({ filters, update, selectedIds }) {
  const { t, number, percent } = useGeoText();
  const wilayaName = useWilayaName();
  const [metric, setMetric] = useState('sales_units');
  const [compare, setCompare] = useState(false);
  // The map shows every wilaya (so you can switch from one to another); the filter highlights it.
  const mapFilters = Object.fromEntries(
    Object.entries(filters).filter(([key]) => key !== 'wilayaIds'),
  );
  const current = useReport('/geo/wilayas', { ...mapFilters, metric });
  const period = current.data?.period;
  const previousPeriod = period
    ? {
        from: shift(period.from, -((Date.parse(period.to) - Date.parse(period.from)) / DAY + 1)),
        to: shift(period.from, -1),
      }
    : null;
  const previous = useReport(
    '/geo/wilayas',
    { ...mapFilters, ...previousPeriod, metric },
    compare && Boolean(previousPeriod),
  );
  const rows = current.data?.polygons ?? [];
  const ratio = RATIO_GEO_METRICS.includes(metric);
  const model = useChoroplethModel({
    rows,
    previousRows: previous.data?.polygons,
    metric,
    compare: compare && Boolean(previous.data),
    wilayaName,
  });
  const selectedCodes = useMemo(
    () =>
      new Set(
        rows
          .filter((row) => row.wilayaIds.every((id) => selectedIds.has(id)))
          .map((row) => row.polygonCode),
      ),
    [rows, selectedIds],
  );
  const select = (code) => {
    const ids = wilayasOfPolygon(code);
    update({ wilayaIds: selectedCodes.has(code) ? '' : ids.join(',') });
  };
  const ranked = rows.filter((row) => row.rank != null).sort((a, b) => a.rank - b.rank);
  const label = (row) => wilayaName(Number(row.polygonCode));
  const list = (items) => (
    <ol className="space-y-0.5 text-sm">
      {items.map((row) => (
        <li key={row.polygonCode}>
          <button
            type="button"
            onClick={() => select(row.polygonCode)}
            aria-pressed={selectedCodes.has(row.polygonCode)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1 text-start hover:bg-sunken',
              selectedCodes.has(row.polygonCode) && 'bg-accent-soft',
            )}
          >
            <span className="tnum w-6 text-fg-3">{row.rank}</span>
            <span className="min-w-0 flex-1 truncate">{label(row)}</span>
            <span className="tnum font-medium">
              {ratio ? percent(row.value) : number(row.value)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
  const selectedNames = [...selectedIds].map((id) => wilayaName(id)).join(', ');
  if (current.isPending) return <MapFallback />;
  if (current.isError) return <p role="alert">{t('error')}</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-fg-3">
          {t('metric')}
          <select
            className={controlClass + ' w-64'}
            value={metric}
            onChange={(event) => setMetric(event.target.value)}
          >
            {GEO_METRICS.map((value) => (
              <option key={value} value={value}>
                {t('metric.' + value)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          {t('change')}
        </label>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => update({ wilayaIds: '' })}
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-3 text-xs font-medium text-accent-text"
          >
            <span>{t('filteredBy', { names: selectedNames })}</span>
            <span aria-hidden="true">×</span>
            <span className="sr-only">{t('reset')}</span>
          </button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(15rem,1fr)]">
        <div className="min-w-0 space-y-2">
          <Suspense fallback={<MapFallback />}>
            <ChoroplethMap model={model} selectedCodes={selectedCodes} onSelect={select} />
          </Suspense>
          <ChoroplethLegend model={model} metric={metric} period={period} />
          <p className="text-xs text-fg-3">{t('clickHint')}</p>
        </div>
        <aside className="space-y-4 text-sm">
          <section>
            <h3 className="mb-1 text-xs font-medium tracking-wide text-fg-3 uppercase">
              {t('top')}
            </h3>
            {list(ranked.slice(0, 5))}
          </section>
          {ranked.length > 5 && (
            <section>
              <h3 className="mb-1 text-xs font-medium tracking-wide text-fg-3 uppercase">
                {t('bottom')}
              </h3>
              {list(ranked.slice(-5).reverse())}
            </section>
          )}
          <details>
            <summary className="cursor-pointer text-fg-2">{t('viewTable')}</summary>
            <div className="mt-2">{list(ranked)}</div>
          </details>
        </aside>
      </div>
    </div>
  );
}

function TimingPanel({ filters }) {
  const { t } = useGeoText();
  const sales = useReport('/heatmap', { ...filters, kind: 'sales' });
  const late = useReport('/heatmap', { ...filters, kind: 'attendance_late' });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {[
        ['sales', sales],
        ['attendance_late', late],
      ].map(([kind, query]) =>
        query.isPending ? (
          <MapFallback key={kind} height="14rem" />
        ) : query.isError ? (
          <p key={kind} role="alert">
            {t('error')}
          </p>
        ) : (
          <Suspense key={kind} fallback={<MapFallback height="14rem" />}>
            <HeatmapGrid matrix={query.data.matrix} kind={kind} title={t('heatmap.' + kind)} />
          </Suspense>
        ),
      )}
    </div>
  );
}

/**
 * Dashboard "Geography": wilaya choropleth (click = filter), store map, and weekday-by-hour
 * heatmaps. Every number comes from the same reporting service as the cards and tables.
 */
export function GeographySection({ filters, update }) {
  const { t } = useGeoText();
  const [tab, setTab] = useState('wilayas');
  const selectedIds = useMemo(() => new Set(filters.wilayaIds ?? []), [filters.wilayaIds]);
  return (
    <section className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-semibold tracking-tight">{t('geography')}</h2>
      <TabStrip
        label={t('geography')}
        idPrefix="geo"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'wilayas', label: t('wilayas') },
          { value: 'stores', label: t('stores') },
          { value: 'timing', label: t('timing') },
        ]}
      />
      {tab === 'wilayas' && (
        <WilayaPanel filters={filters} update={update} selectedIds={selectedIds} />
      )}
      {tab === 'stores' && <StoreMapPanel filters={filters} />}
      {tab === 'timing' && <TimingPanel filters={filters} />}
    </section>
  );
}
