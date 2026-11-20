import { Router } from 'express';
import { API_PREFIX, APP_VERSION } from './config/constants.js';

/**
 * Mounts every API route under /api/v1. Modules register their routers here.
 * @param {{ checkDatabase: () => Promise<boolean> }} deps
 */
export function createRoutes({ checkDatabase }) {
  const api = Router();

  // 200 when everything is up; 503 (same envelope) when the database is unreachable,
  // so load balancers and the web app can tell the API is running but degraded.
  api.get('/health', async (_req, res) => {
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

  const root = Router();
  root.use(API_PREFIX, api);
  return root;
}
