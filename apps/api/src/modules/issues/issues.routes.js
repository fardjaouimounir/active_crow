import * as schema from '@fieldflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { NotFoundError } from '../../core/errors/index.js';
import { uploadIssueAttachments } from './issues.upload.js';
import { validate } from '../../core/http/index.js';
import { requireIdempotencyKey } from '../../core/http/idempotency.js';
import * as controller from './issues.controller.js';
const params = z.strictObject({ id: z.uuid() });
const empty = z.strictObject({});
const hideClient = (req, _res, next) =>
  next(req.actor.role === 'client' ? new NotFoundError() : undefined);
export function createIssuesRouter() {
  const router = Router();
  router.get(
    '/issues',
    authenticate,
    hideClient,
    requirePermission('issue.read'),
    validate({ query: schema.issueFilters }),
    controller.list,
  );
  router.post(
    '/issues',
    authenticate,
    hideClient,
    requirePermission('issue.create'),
    uploadIssueAttachments,
    validate({ query: empty, body: schema.issueCreate }),
    (req, res, next) =>
      req.get('Idempotency-Key') === undefined ? next() : requireIdempotencyKey(req, res, next),
    controller.create,
  );
  router.get(
    '/issues/:id',
    authenticate,
    hideClient,
    requirePermission('issue.read'),
    validate({ params, query: empty }),
    controller.detail,
  );
  router.get(
    '/issues/:id/comments',
    authenticate,
    hideClient,
    requirePermission('issue.read'),
    validate({ params, query: empty }),
    controller.comments,
  );
  router.post(
    '/issues/:id/comments',
    authenticate,
    hideClient,
    requirePermission('issue.read'),
    uploadIssueAttachments,
    validate({ params, query: empty, body: schema.issueComment }),
    controller.comment,
  );
  router.post(
    '/issues/:id/assign',
    authenticate,
    hideClient,
    requirePermission('issue.manage'),
    validate({ params, query: empty, body: schema.issueAssign }),
    controller.assign,
  );
  router.post(
    '/issues/:id/start',
    authenticate,
    hideClient,
    requirePermission('issue.manage'),
    validate({ params, query: empty, body: schema.issueChange }),
    controller.start,
  );
  router.post(
    '/issues/:id/resolve',
    authenticate,
    hideClient,
    requirePermission('issue.manage'),
    validate({ params, query: empty, body: schema.issueChange }),
    controller.resolve,
  );
  router.post(
    '/issues/:id/reopen',
    authenticate,
    hideClient,
    requirePermission('issue.read'),
    validate({ params, query: empty, body: schema.issueChange }),
    controller.reopen,
  );
  router.post(
    '/issues/:id/close',
    authenticate,
    hideClient,
    requirePermission('issue.manage'),
    validate({ params, query: empty, body: schema.issueChange }),
    controller.close,
  );
  return router;
}
