import * as schema from '@fieldflow/shared';
import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { GUARD, requirePermission } from '../../core/authz/index.js';
import { tagGuard } from '../../core/authz/routeGuards.js';
import { ForbiddenError, NotFoundError } from '../../core/errors/index.js';
import { requireIdempotencyKey, validate } from '../../core/http/index.js';
import * as controller from './inventory.controller.js';
import { uploadOptionalProof } from './inventory.upload.js';
import * as input from './inventory.validators.js';

const hideFromClient = (req, _res, next) =>
  next(req.actor.role === 'client' ? new NotFoundError() : undefined);
const anyOf = (...grants) =>
  tagGuard(
    (req, _res, next) =>
      next(
        grants.some((grant) => schema.can(req.actor.role, grant))
          ? undefined
          : new ForbiddenError(),
      ),
    GUARD.PERMISSION,
  );

/** Mounted at the API root: the stock endpoints live under /campaigns/:id/stock, /stock and /me. */
export function createInventoryRouter() {
  const router = Router();
  const { params, movementParams, empty } = input;
  const read = [authenticate, hideFromClient, requirePermission('inventory.read')];
  const write = (permission, ...middleware) => [
    authenticate,
    hideFromClient,
    requirePermission(permission),
    ...middleware,
  ];

  router.get(
    '/campaigns/:id/stock/balances',
    ...read,
    validate({ params, query: empty }),
    controller.balances,
  );
  router.get(
    '/campaigns/:id/stock/movements',
    ...read,
    validate({ params, query: schema.movementFilters }),
    controller.movements,
  );
  router.get(
    '/campaigns/:id/stock/reconciliation',
    ...read,
    validate({ params, query: empty }),
    controller.reconciliation,
  );
  router.get(
    '/campaigns/:id/stock/recipients',
    ...read,
    validate({ params, query: schema.recipientsQuery }),
    controller.recipients,
  );
  router.get(
    '/stock/movements/:movementId',
    ...read,
    validate({ params: movementParams, query: empty }),
    controller.movementDetail,
  );
  router.get('/me/stock', ...read, validate({ query: empty }), controller.mine);

  router.post(
    '/campaigns/:id/stock/stock-in',
    ...write('inventory.stock_in', uploadOptionalProof('stock_document')),
    validate({ params, query: empty, body: input.stockInInput }),
    requireIdempotencyKey,
    controller.stockIn,
  );
  router.post(
    '/campaigns/:id/stock/transfers',
    ...write('inventory.transfer'),
    validate({ params, query: empty, body: schema.transferBody }),
    requireIdempotencyKey,
    controller.transfer,
  );
  router.post(
    '/campaigns/:id/stock/returns',
    ...write('inventory.return'),
    validate({ params, query: empty, body: schema.returnBody }),
    requireIdempotencyKey,
    controller.giveBack,
  );
  router.post(
    '/campaigns/:id/stock/adjustments',
    ...write('inventory.adjust.request', uploadOptionalProof('stock_adjustment_proof')),
    validate({ params, query: empty, body: input.adjustmentInput }),
    requireIdempotencyKey,
    controller.requestAdjustment,
  );
  router.post(
    '/stock/transfers/:movementId/confirm',
    ...write('inventory.confirm'),
    validate({ params: movementParams, query: empty, body: schema.confirmBody }),
    requireIdempotencyKey,
    controller.confirm,
  );
  router.post(
    '/stock/transfers/:movementId/cancel',
    authenticate,
    hideFromClient,
    anyOf('inventory.transfer', 'inventory.return'),
    validate({ params: movementParams, query: empty, body: schema.emptyBody }),
    requireIdempotencyKey,
    controller.cancel,
  );
  router.post(
    '/stock/transfers/:movementId/resolve',
    ...write('inventory.adjust.approve'),
    validate({ params: movementParams, query: empty, body: schema.resolveBody }),
    requireIdempotencyKey,
    controller.resolve,
  );
  router.post(
    '/stock/adjustments/:movementId/approve',
    ...write('inventory.adjust.approve'),
    validate({ params: movementParams, query: empty, body: schema.adjustmentApprovalBody }),
    requireIdempotencyKey,
    controller.decide('approve'),
  );
  router.post(
    '/stock/adjustments/:movementId/reject',
    ...write('inventory.adjust.approve'),
    validate({ params: movementParams, query: empty, body: schema.adjustmentRejectionBody }),
    requireIdempotencyKey,
    controller.decide('reject'),
  );
  return router;
}
