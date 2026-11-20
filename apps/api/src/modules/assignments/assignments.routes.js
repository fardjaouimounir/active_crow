import * as schema from '@fieldflow/shared';
import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { GUARD, tagGuard } from '../../core/authz/routeGuards.js';
import { ForbiddenError, NotFoundError } from '../../core/errors/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './assignments.controller.js';

import { empty, params, validateBatch } from './assignments.validators.js';
const hideFromClient = (req, _res, next) =>
  next(req.actor.role === 'client' ? new NotFoundError() : undefined);
const permission = (grants) =>
  grants.length === 1
    ? requirePermission(grants[0])
    : tagGuard(
        (req, _res, next) =>
          next(
            grants.some((grant) => schema.can(req.actor.role, grant))
              ? undefined
              : new ForbiddenError(),
          ),
        GUARD.PERMISSION,
      );

export function createAssignmentsRouter() {
  const router = Router();
  router.get(
    '/campaigns/:id/assignments',
    authenticate,
    hideFromClient,
    permission(['assignment.read']),
    validate({ params, query: schema.assignmentFilters }),
    controller.list,
  );
  router.post(
    '/campaigns/:id/assignments',
    authenticate,
    hideFromClient,
    permission(['assignment.propose']),
    validate({ params, query: empty, body: schema.assignmentProposal }),
    controller.propose,
  );
  router.post(
    '/campaigns/:id/assignments/batch',
    authenticate,
    hideFromClient,
    permission(['assignment.propose']),
    validateBatch({ params, query: empty, body: schema.assignmentProposals }),
    controller.batch,
  );
  router.get(
    '/campaigns/:id/assignment-candidates',
    authenticate,
    hideFromClient,
    permission(['assignment.propose']),
    validate({ params, query: schema.assignmentCandidates }),
    controller.candidates,
  );
  router.get(
    '/campaigns/:id/staffing',
    authenticate,
    hideFromClient,
    permission(['assignment.read']),
    validate({ params, query: schema.staffingDate }),
    controller.staffing,
  );
  router.get(
    '/assignments/pending',
    authenticate,
    hideFromClient,
    permission(['assignment.approve']),
    validate({ query: schema.assignmentPaging }),
    controller.pending,
  );
  router.post(
    '/assignments/decisions',
    authenticate,
    hideFromClient,
    permission(['assignment.approve']),
    validateBatch({ query: empty, body: schema.assignmentDecisions }),
    controller.decisions,
  );
  router.post(
    '/assignments/:id/approve',
    authenticate,
    hideFromClient,
    permission(['assignment.approve']),
    validate({ params, query: empty, body: schema.assignmentDecision }),
    controller.approve,
  );
  router.post(
    '/assignments/:id/reject',
    authenticate,
    hideFromClient,
    permission(['assignment.approve']),
    validate({ params, query: empty, body: schema.assignmentDecision }),
    controller.reject,
  );
  router.post(
    '/assignments/:id/cancel',
    authenticate,
    hideFromClient,
    permission(['assignment.propose', 'assignment.approve']),
    validate({ params, query: empty, body: schema.assignmentDecision }),
    controller.cancel,
  );
  router.post(
    '/assignments/:id/end',
    authenticate,
    hideFromClient,
    permission(['assignment.approve']),
    validate({ params, query: empty, body: schema.assignmentEnd }),
    controller.end,
  );
  router.post(
    '/assignments/:id/replace',
    authenticate,
    hideFromClient,
    permission(['assignment.propose', 'assignment.approve']),
    validate({ params, query: empty, body: schema.assignmentReplacement }),
    controller.replace,
  );
  router.get(
    '/me/assignments',
    authenticate,
    hideFromClient,
    permission(['assignment.read']),
    validate({ query: empty }),
    controller.mine,
  );
  return router;
}
