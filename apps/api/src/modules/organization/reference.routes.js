import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './reference.controller.js';

const query = z.strictObject({});
const params = z.strictObject({
  id: z.string().regex(/^\d+$/).transform(Number).pipe(z.int().min(1).max(32767)),
});

export function createReferenceRouter() {
  const router = Router();
  const read = requirePermission('reference.read');
  router.get('/wilayas', authenticate, read, validate({ query }), controller.wilayas);
  router.get(
    '/wilayas/:id/communes',
    authenticate,
    read,
    validate({ params, query }),
    controller.communes,
  );
  return router;
}
