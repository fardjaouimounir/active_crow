import { operation } from '../../core/http/openapi.js';
import { XLSX } from './reporting.columns.js';
import * as input from './reporting.validators.js';

export function registerReportingOpenApi(registry) {
  const get = (path, summary, permission, options) =>
    registry.register(operation('get', '/reports' + path, summary, permission, options));
  get('/kpis', 'Read reporting KPIs', 'reports.read', { query: input.kpis });
  get('/breakdown', 'Read a reporting breakdown', 'reports.read', {
    query: input.breakdown,
    array: true,
  });
  get('/geo/wilayas', 'Read one metric per wilaya and map polygon', 'reports.read', {
    query: input.geoWilayas,
  });
  get('/geo/stores', 'Read stores with coordinates and map figures', 'reports.read', {
    query: input.geoStores,
  });
  get('/heatmap', 'Read a weekday by hour heatmap', 'reports.read', { query: input.heatmap });
  get('/campaigns/{id}/summary', 'Read the final campaign report', 'reports.read', {
    params: input.params,
  });
  get('/export.xlsx', 'Download dashboard Excel', 'reports.export', {
    query: input.dashboardExport,
    binary: [XLSX],
  });
  get('/campaigns/{id}/export.xlsx', 'Download campaign Excel', 'reports.export', {
    params: input.params,
    binary: [XLSX],
  });
}
