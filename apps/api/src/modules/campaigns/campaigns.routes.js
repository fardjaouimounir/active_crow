import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { NotFoundError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import { registerFileAccessPolicy } from '../files/fileAccessPolicies.js';
import { uploadFile } from '../files/upload.js';
import * as controller from './campaigns.controller.js';
import { campaignDocumentPolicy } from './campaigns.policies.js';
import * as input from './campaigns.validators.js';
import { addRuleSetRoutes } from './ruleSets.routes.js';

/** Mounted at `/campaigns`; also registers the `campaign_document` file access policy. */
export function createCampaignsRouter() {
  registerFileAccessPolicy('campaign_document', campaignDocumentPolicy);
  const router = Router();
  // Clients read their campaigns through /portal (aggregates only), never through these routes.
  const staffOnly = (req, _res, next) =>
    next(req.actor.role === 'client' ? new NotFoundError() : undefined);
  const read = [requirePermission('campaign.read'), staffOnly];
  const manage = requirePermission('campaign.manage');
  const query = input.empty;
  const params = input.params;

  router.get('/', authenticate, read, validate({ query: input.campaignList }), controller.list);
  router.post(
    '/',
    authenticate,
    manage,
    validate({ query, body: input.createCampaign }),
    controller.create,
  );
  router.get('/:id', authenticate, read, validate({ query, params }), controller.detail);
  router.patch(
    '/:id',
    authenticate,
    manage,
    validate({ query, params, body: input.updateCampaign }),
    controller.update,
  );
  router.put(
    '/:id/wilayas',
    authenticate,
    manage,
    validate({ query, params, body: input.wilayas }),
    controller.setWilayas,
  );
  router.post(
    '/:id/staff',
    authenticate,
    manage,
    validate({ query, params, body: input.staff }),
    controller.addStaff,
  );
  router.delete(
    '/:id/staff/:staffId',
    authenticate,
    manage,
    validate({ query, params: input.staffParams, body: input.empty }),
    controller.removeStaff,
  );
  router.put(
    '/:id/points-of-sale',
    authenticate,
    manage,
    validate({ query, params, body: input.pointsOfSale }),
    controller.setPointsOfSale,
  );
  router.put(
    '/:id/products',
    authenticate,
    manage,
    validate({ query, params, body: input.products }),
    controller.setProducts,
  );
  router.get(
    '/:id/documents',
    authenticate,
    read,
    validate({ query, params }),
    controller.documents,
  );
  router.post(
    '/:id/documents',
    authenticate,
    requirePermission('campaign.manage', 'file.upload'),
    validate({ query, params }),
    uploadFile('campaign_document'),
    validate({ body: input.documentLabel }),
    controller.addDocument,
  );
  router.patch(
    '/:id/documents/:documentId',
    authenticate,
    manage,
    validate({ query, params: input.documentParams, body: input.documentLabel }),
    controller.relabelDocument,
  );
  router.delete(
    '/:id/documents/:documentId',
    authenticate,
    manage,
    validate({ query, params: input.documentParams, body: input.empty }),
    controller.removeDocument,
  );
  router.get(
    '/:id/status-history',
    authenticate,
    read,
    validate({ query, params }),
    controller.statusHistory,
  );
  addRuleSetRoutes(router);
  return router;
}
