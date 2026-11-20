import { Router } from 'express';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import {
  createUser,
  emptyInput as empty,
  transferBody,
  updateUser,
  userListQuery,
  userParams as params,
} from './userManagement.validators.js';
import * as controller from './users.controller.js';

export function createUsersRouter() {
  const router = Router();
  router.get(
    '/',
    authenticate,
    requirePermission('org.user.read'),
    validate({ query: userListQuery }),
    controller.list,
  );
  const read = requirePermission('org.user.read');
  const manage = requirePermission('org.user.manage');
  const actionInput = validate({ params, query: empty, body: empty });
  router.get('/:id', authenticate, read, validate({ params, query: empty }), controller.detail);
  router.get(
    '/:id/reporting-lines',
    authenticate,
    read,
    validate({ params, query: empty }),
    controller.reportingLines,
  );
  router.post(
    '/',
    authenticate,
    manage,
    validate({ body: createUser, query: empty }),
    controller.create,
  );
  router.patch(
    '/:id',
    authenticate,
    manage,
    validate({ params, body: updateUser, query: empty }),
    controller.update,
  );
  router.post(
    '/:id/suspend',
    authenticate,
    manage,
    actionInput,
    controller.changeStatus('suspended'),
  );
  router.post(
    '/:id/reactivate',
    authenticate,
    manage,
    actionInput,
    controller.changeStatus('active'),
  );
  router.post('/:id/mark-left', authenticate, manage, actionInput, controller.changeStatus('left'));
  router.post('/:id/reset-password', authenticate, manage, actionInput, controller.resetPassword);
  const canTransfer = requirePermission('org.transfer');
  const transferInput = validate({ params, query: empty, body: transferBody });
  router.post('/:id/transfers', authenticate, canTransfer, transferInput, controller.transfer);
  router.post(
    '/:id/transfers/team',
    authenticate,
    canTransfer,
    transferInput,
    controller.transferTeam,
  );
  router.delete(
    '/:id/transfers/scheduled',
    authenticate,
    canTransfer,
    validate({ params, body: empty, query: empty }),
    controller.cancelTransfer,
  );
  return router;
}
