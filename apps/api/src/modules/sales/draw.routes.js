import { drawInput, winnerDeliveredInput, winnerUnreachableInput } from '@fieldflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as draw from './draw.service.js';

const empty = z.strictObject({});
const params = z.strictObject({ id: z.uuid() });
const winnerParams = z.strictObject({ id: z.uuid(), winnerId: z.uuid() });
export const winnersQuery = z.strictObject({ personal: z.enum(['true']).optional() });
export { winnerParams, params as drawParams };

const data =
  (fn, status = 200) =>
  async (req, res) =>
    res.status(status).json({ data: await fn(req) });

/** Tombola draw, verification, winners and prize delivery. Clients and agency-wide staff only. */
export function createDrawRouter() {
  const router = Router();
  const route = (method, path, permission, schemas, handler) =>
    router[method](
      path,
      authenticate,
      requirePermission(permission),
      validate({
        params: path.includes(':winnerId') ? winnerParams : params,
        query: empty,
        body: empty,
        ...schemas,
      }),
      handler,
    );
  route(
    'get',
    '/tombolas/:id',
    'tombola.read',
    {},
    data((req) => draw.get(req.actor, req.params.id)),
  );
  route(
    'get',
    '/tombolas/:id/draw/verification',
    'tombola.read',
    {},
    data((req) => draw.verification(req.actor, req.params.id)),
  );
  route(
    'post',
    '/tombolas/:id/draw',
    'tombola.draw',
    { body: drawInput },
    data((req) => draw.draw(req.actor, req.params.id, req.body, req), 201),
  );
  route('get', '/tombolas/:id/winners', 'tombola.read', { query: winnersQuery }, async (req, res) =>
    res.json(
      await draw.winners(
        req.actor,
        req.params.id,
        { personal: req.query.personal === 'true' },
        req,
      ),
    ),
  );
  route(
    'post',
    '/tombolas/:id/winners/:winnerId/unreachable',
    'tombola.deliver',
    { body: winnerUnreachableInput },
    data((req) =>
      draw.markUnreachable(req.actor, req.params.id, req.params.winnerId, req.body, req),
    ),
  );
  route(
    'post',
    '/tombolas/:id/winners/:winnerId/delivered',
    'tombola.deliver',
    { body: winnerDeliveredInput },
    data((req) => draw.markDelivered(req.actor, req.params.id, req.params.winnerId, req.body, req)),
  );
  return router;
}
