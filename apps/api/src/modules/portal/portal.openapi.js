import { operation } from '../../core/http/openapi.js';
import { XLSX } from '../reporting/reporting.columns.js';
import { breakdownQuery, params } from './portal.routes.js';

export function registerPortalOpenApi(registry) {
  const get = (path, summary, permission, options) =>
    registry.register(operation('get', '/portal' + path, summary, permission, options));
  get('/campaigns', 'List the campaigns of the client with headline KPIs', 'report.read', {
    array: true,
  });
  get('/campaigns/{id}', 'Read one campaign for the client portal', 'report.read', { params });
  get('/campaigns/{id}/kpis', 'Client view of the campaign KPIs', 'report.read', { params });
  get('/campaigns/{id}/breakdown', 'Totals by day, wilaya, store or product', 'report.read', {
    params,
    query: breakdownQuery,
    array: true,
  });
  get('/campaigns/{id}/proof', 'Visit photos shared with the client', 'report.read', {
    params,
    array: true,
  });
  get('/campaigns/{id}/documents', 'Documents shared with the client', 'report.read', {
    params,
    array: true,
  });
  get('/campaigns/{id}/export.xlsx', 'Download the client Excel report', 'report.export', {
    params,
    binary: [XLSX],
  });
}
