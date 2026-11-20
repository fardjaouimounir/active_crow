import { useChoroplethModel, ChoroplethLegend } from './ChoroplethMap.jsx';
import { useGeoText } from './geoMessages.js';
import { SvgMap } from './SvgMap.jsx';

/**
 * Print-safe snapshot of a choropleth: the same boundaries and classes as the interactive map,
 * drawn as plain SVG with no basemap, no script and no tiles, so it survives "Save as PDF".
 */
export function StaticChoropleth({ data, metric = 'sales_units', wilayaName }) {
  const { t } = useGeoText();
  const model = useChoroplethModel({ rows: data.polygons, metric, compare: false, wilayaName });
  if (!data.polygons.length) return null;
  return (
    <section className="report-section space-y-2">
      <h2 className="text-lg font-semibold tracking-tight">{t('geography')}</h2>
      <SvgMap
        interactive={false}
        label={t('mapLabel')}
        className="max-w-xl"
        fills={Object.fromEntries(
          Object.entries(model.tokens).map(([code, token]) => [code, `var(${token})`]),
        )}
      />
      <ChoroplethLegend model={model} metric={metric} period={data.period} />
    </section>
  );
}
