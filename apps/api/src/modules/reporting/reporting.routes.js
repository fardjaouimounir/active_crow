import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { NotFoundError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './reporting.controller.js';
import * as input from './reporting.validators.js';

function hideClient(req, _res, next) {
  next(req.actor.role === 'client' ? new NotFoundError() : undefined);
}

export function createReportingRouter() {
  const router = Router();
  const get = (path, permission, query, handler) =>
    router.get(
      path,
      authenticate,
      hideClient,
      requirePermission(permission),
      validate({
        query,
        params: path.includes(':id') ? input.params : input.empty,
        body: input.empty,
      }),
      handler,
    );
  get('/kpis', 'reports.read', input.kpis, controller.kpis);
  get('/breakdown', 'reports.read', input.breakdown, controller.breakdown);
  get('/campaigns/:id/summary', 'reports.read', input.empty, controller.summary);
  get('/export.xlsx', 'reports.export', input.dashboardExport, controller.exportDashboard);
  get('/campaigns/:id/export.xlsx', 'reports.export', input.empty, controller.exportCampaign);
  return router;
}
