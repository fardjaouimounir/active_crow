import { CLIENT_GEO_METRICS } from '@fieldflow/shared/wilayaPolygons';
import { useMemo, useState } from 'react';
import { useWilayaName } from '../../features/reporting/useWilayaName.js';
import { Skeleton, controlClass } from '../../ui/primitives.jsx';
import {
  ChoroplethLegend,
  ChoroplethMap,
  useChoroplethModel,
} from '../../ui/map/ChoroplethMap.jsx';
import { StoreMap } from '../../ui/map/StoreMap.jsx';
import { useGeoText } from '../../ui/map/geoMessages.js';
import { usePortalQuery } from './api.js';

/**
 * The client's maps: sales by wilaya and the stores that sold. Aggregated figures only, stores by
 * name and wilaya; no attendance, visits, issues or staff (the endpoints do not return them).
 */
export function PortalGeography({ campaignId }) {
  const { t, number } = useGeoText();
  const wilayaName = useWilayaName();
  const [metric, setMetric] = useState('sales_units');
  const wilayas = usePortalQuery(`/portal/campaigns/${campaignId}/geo/wilayas`, { metric });
  const stores = usePortalQuery(`/portal/campaigns/${campaignId}/geo/stores`);
  const model = useChoroplethModel({
    rows: wilayas.data?.polygons ?? [],
    metric,
    compare: false,
    wilayaName,
  });
  const none = useMemo(() => new Set(), []);
  const located = stores.data?.stores ?? [];
  if (wilayas.isError || stores.isError) return <p role="alert">{t('error')}</p>;
  return (
    <section className="report-actions space-y-4 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-semibold tracking-tight">{t('geography')}</h2>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <label className="grid max-w-64 gap-1 text-xs text-fg-3">
            {t('metric')}
            <select
              className={controlClass}
              value={metric}
              onChange={(event) => setMetric(event.target.value)}
            >
              {CLIENT_GEO_METRICS.map((value) => (
                <option key={value} value={value}>
                  {t('metric.' + value)}
                </option>
              ))}
            </select>
          </label>
          {wilayas.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : (
            <ChoroplethMap model={model} selectedCodes={none} height="24rem" />
          )}
          <ChoroplethLegend model={model} metric={metric} period={wilayas.data?.period} />
        </div>
        <div className="min-w-0 space-y-2">
          <h3 className="text-sm font-medium">{t('storeMap')}</h3>
          {stores.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : located.length ? (
            <StoreMap stores={located} mode="plain" height="24rem" />
          ) : (
            <p className="text-sm text-fg-2">{t('noStores')}</p>
          )}
          <ul className="grid gap-0.5 text-sm">
            {located.map((store) => (
              <li key={store.id} className="flex justify-between gap-3">
                <span className="truncate">
                  {store.name} · {wilayaName(store.wilaya.id, store.wilaya)}
                </span>
                <span className="tnum text-fg-2">
                  {number(store.salesUnits)} {t('units')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
