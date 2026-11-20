import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './structure.controller.js';
import * as input from './structure.validators.js';

export function createStructureRouter() {
  const router = Router();
  const read = requirePermission('org.pos.read');
  const manage = requirePermission('org.structure.manage');
  const query = input.empty;
  const params = input.params;
  router.get('/regions', authenticate, read, validate({ query }), controller.regions);
  router.post(
    '/regions',
    authenticate,
    manage,
    validate({ query, body: input.region }),
    controller.createRegion,
  );
  router.patch(
    '/regions/:id',
    authenticate,
    manage,
    validate({ query, params, body: input.regionPatch }),
    controller.changeRegion('updated'),
  );
  router.delete(
    '/regions/:id',
    authenticate,
    manage,
    validate({ query, params, body: input.empty }),
    controller.changeRegion('deleted'),
  );
  router.put(
    '/regions/:id/wilayas',
    authenticate,
    manage,
    validate({ query, params, body: input.wilayas }),
    controller.changeRegion('wilayas_changed'),
  );
  router.get(
    '/points-of-sale',
    authenticate,
    read,
    validate({ query: input.points }),
    controller.points,
  );
  router.get(
    '/points-of-sale/:id',
    authenticate,
    read,
    validate({ query, params }),
    controller.point,
  );
  router.post(
    '/points-of-sale',
    authenticate,
    manage,
    validate({ query, body: input.createPoint }),
    controller.createPoint,
  );
  router.patch(
    '/points-of-sale/:id',
    authenticate,
    manage,
    validate({ query, params, body: input.updatePoint }),
    controller.updatePoint,
  );
  router.delete(
    '/points-of-sale/:id',
    authenticate,
    manage,
    validate({ query, params, body: input.empty }),
    controller.deletePoint,
  );
  return router;
}
