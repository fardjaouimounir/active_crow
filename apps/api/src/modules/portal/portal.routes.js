import { ERROR_CODES } from '@fieldflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { AppError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import { download } from './portal.excel.js';
import { portalService } from './portal.service.js';

const empty = z.strictObject({});
export const params = z.strictObject({ id: z.uuid() });
export const breakdownQuery = z.strictObject({ dimension: z.string().optional() });
export const PORTAL_DIMENSIONS = ['day', 'wilaya', 'point_of_sale', 'product'];

const data = (fn) => async (req, res) => res.json({ data: await fn(req) });

/** Mounted at `/portal`. Client users (their own campaigns) and the director (preview). */
export function createPortalRouter() {
  const router = Router();
  const get = (path, permission, query, handler) =>
    router.get(
      path,
      authenticate,
      requirePermission(permission),
      validate({ params: path.includes(':id') ? params : empty, query, body: empty }),
      handler,
    );
  get(
    '/campaigns',
    'report.read',
    empty,
    data((req) => portalService.list(req.actor)),
  );
  get(
    '/campaigns/:id',
    'report.read',
    empty,
    data((req) => portalService.get(req.actor, req.params.id)),
  );
  get(
    '/campaigns/:id/kpis',
    'report.read',
    empty,
    data((req) => portalService.kpis(req.actor, req.params.id)),
  );
  get(
    '/campaigns/:id/breakdown',
    'report.read',
    breakdownQuery,
    data((req) => {
      // Only totals by day, wilaya, store and product: never by Animateur or supervisor.
      if (!PORTAL_DIMENSIONS.includes(req.query.dimension))
        throw new AppError({
          status: 422,
          code: ERROR_CODES.INVALID_DIMENSION,
          message: 'Invalid reporting dimension',
        });
      return portalService.breakdown(req.actor, req.params.id, req.query.dimension);
    }),
  );
  get(
    '/campaigns/:id/proof',
    'report.read',
    empty,
    data((req) => portalService.proof(req.actor, req.params.id)),
  );
  get(
    '/campaigns/:id/documents',
    'report.read',
    empty,
    data((req) => portalService.documents(req.actor, req.params.id)),
  );
  get('/campaigns/:id/export.xlsx', 'report.export', empty, (req, res) =>
    download(req, res, req.params.id),
  );
  return router;
}
