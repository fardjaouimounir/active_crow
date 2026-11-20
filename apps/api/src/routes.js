import { createInventoryRouter } from './modules/inventory/inventory.routes.js';
import { createAttendanceRouter } from './modules/attendance/attendance.routes.js';
import { createDrawRouter } from './modules/sales/draw.routes.js';
import { createPortalRouter } from './modules/portal/portal.routes.js';
import { createSalesRouter } from './modules/sales/sales.routes.js';
import { createNotificationsRouter } from './modules/notifications/notifications.routes.js';
import { createIssuesRouter } from './modules/issues/issues.routes.js';
import { createAnnouncementsRouter } from './modules/announcements/announcements.routes.js';
import { createAiRouter } from './modules/ai/ai.routes.js';
import { createReportingRouter } from './modules/reporting/reporting.routes.js';
import { Router } from 'express';
import { API_PREFIX, APP_VERSION } from './config/constants.js';
import { publicRoute } from './core/authz/index.js';
import { createAssignmentsRouter } from './modules/assignments/assignments.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createCampaignsRouter } from './modules/campaigns/campaigns.routes.js';
import { createCatalogRouter } from './modules/catalog/catalog.routes.js';
import { createFilesRouter } from './modules/files/files.routes.js';
import { createOrganizationRouter } from './modules/organization/organization.routes.js';
import { createReferenceRouter } from './modules/organization/reference.routes.js';
import { createStructureRouter } from './modules/organization/structure.routes.js';
import { createUsersRouter } from './modules/organization/users.routes.js';

/**
 * Mounts every API route under /api/v1. Modules register their routers here.
 * Deny by default: a route is either `publicRoute()` or `authenticate` + `requirePermission` /
 * `anyAuthenticated` (enforced by test/routeGuards.test.js).
 * @param {{ checkDatabase: () => Promise<boolean> }} deps
 */
export function createRoutes({ checkDatabase }) {
  const api = Router();

  // 200 when everything is up; 503 (same envelope) when the database is unreachable,
  // so load balancers and the web app can tell the API is running but degraded.
  api.get('/health', publicRoute(), async (_req, res) => {
    const dbUp = await checkDatabase();
    res.status(dbUp ? 200 : 503).json({
      data: {
        status: dbUp ? 'ok' : 'degraded',
        db: dbUp ? 'up' : 'down',
        version: APP_VERSION,
        uptimeSeconds: Math.floor(process.uptime()),
      },
    });
  });

  api.use('/reports', createReportingRouter());
  api.use('/ai', createAiRouter());
  api.use('/portal', createPortalRouter());
  api.use('/auth', createAuthRouter());
  api.use('/reference', createReferenceRouter());
  api.use('/organization', createOrganizationRouter());
  api.use('/users', createUsersRouter());
  api.use('/clients', createCatalogRouter());
  api.use('/files', createFilesRouter());
  api.use(createAssignmentsRouter());
  api.use(createInventoryRouter());
  api.use(createAttendanceRouter());
  api.use(createSalesRouter());
  api.use(createDrawRouter());
  api.use('/campaigns', createCampaignsRouter());
  api.use(createNotificationsRouter());
  api.use(createIssuesRouter());
  api.use(createAnnouncementsRouter());
  api.use(createStructureRouter());

  const root = Router();
  root.use(API_PREFIX, api);
  return root;
}
