import { Router } from 'express';
import { API_PREFIX, APP_VERSION } from './config/constants.js';
import { ok } from './core/http/index.js';

/** Mounts every API route under /api/v1. Modules register their routers here. */
export function createRoutes() {
  const api = Router();

  api.get('/health', (_req, res) => {
    ok(res, {
      status: 'ok',
      version: APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  const root = Router();
  root.use(API_PREFIX, api);
  return root;
}
