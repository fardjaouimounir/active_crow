import { reportingFilterFields, reportingFilters } from '@fieldflow/shared';
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
