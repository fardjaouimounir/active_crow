import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './organization.controller.js';

export function createOrganizationRouter() {
  const router = Router();
  router.get(
    '/tree',
    authenticate,
    requirePermission('org.user.read'),
    validate({ query: z.strictObject({ at: z.iso.date().optional() }) }),
    controller.tree,
  );
  return router;
}
