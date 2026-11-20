import { Router } from 'express';
import { API_PREFIX, APP_VERSION } from './config/constants.js';
import { publicRoute } from './core/authz/index.js';
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

  api.use('/auth', createAuthRouter());
  api.use('/reference', createReferenceRouter());
  api.use('/organization', createOrganizationRouter());
  api.use('/users', createUsersRouter());
  api.use('/clients', createCatalogRouter());
  api.use('/files', createFilesRouter());
  api.use('/campaigns', createCampaignsRouter());
  api.use(createStructureRouter());

  const root = Router();
  root.use(API_PREFIX, api);
  return root;
}
