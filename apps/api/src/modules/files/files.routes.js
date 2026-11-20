import { fileVisibilityBodySchema } from '@fieldflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';
import { validate } from '../../core/http/index.js';
import * as controller from './files.controller.js';
import { filePolicy } from './filePolicy.js';

export const fileParams = z.strictObject({ id: z.uuid() });
const empty = z.strictObject({});

/** Mounted at `/files`. Reads are authorized by the policy of the file's kind. */
export function createFilesRouter() {
  const router = Router();
  const input = validate({ params: fileParams, query: empty });
  router.get('/:id', authenticate, input, filePolicy(), controller.download());
  router.get('/:id/thumbnail', authenticate, input, filePolicy(), controller.download('thumbnail'));
  router.patch(
    '/:id/visibility',
    authenticate,
    requirePermission('file.share_with_client'),
    validate({ params: fileParams, query: empty, body: fileVisibilityBodySchema }),
    controller.setVisibility,
  );
  return router;
}
