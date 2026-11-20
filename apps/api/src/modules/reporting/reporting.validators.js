import { reportingFilterFields, reportingFilters } from '@fieldflow/shared';
import { GEO_METRICS, HEATMAP_KINDS } from '@fieldflow/shared/wilayaPolygons';
import { z } from 'zod';

export const empty = z.strictObject({});
export const params = z.strictObject({ id: z.uuid() });
export const kpis = reportingFilters;
export const breakdown = z
  .strictObject({ ...reportingFilterFields, dimension: z.string().optional() })
  .refine(({ dimension: _dimension, ...filters }) => reportingFilters.safeParse(filters).success, {
    path: ['to'],
    message: 'Invalid period',
  });
export const dashboardExport = z
  .strictObject({ ...reportingFilterFields, view: z.enum(['dashboard']).default('dashboard') })
  .refine(({ view: _view, ...filters }) => reportingFilters.safeParse(filters).success, {
    path: ['to'],
    message: 'Invalid period',
  });

const withPeriod = (shape) =>
  z
    .strictObject(shape)
    .refine(
      ({ metric: _metric, kind: _kind, ...filters }) => reportingFilters.safeParse(filters).success,
      { path: ['to'], message: 'Invalid period' },
    );
export const geoWilayas = withPeriod({
  ...reportingFilterFields,
  metric: z.enum(GEO_METRICS).default('sales_units'),
});
export const geoStores = reportingFilters;
export const heatmap = withPeriod({ ...reportingFilterFields, kind: z.enum(HEATMAP_KINDS) });
