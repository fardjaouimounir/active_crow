import * as schema from '@fieldflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { anyAuthenticated } from '../../core/authz/index.js';

import { validate } from '../../core/http/index.js';
import * as controller from './notifications.controller.js';
const params = z.strictObject({ id: z.uuid() });
const empty = z.strictObject({});

export function createNotificationsRouter() {
  const router = Router();
  router.get(
    '/notifications',
    authenticate,
    anyAuthenticated(),
    validate({ query: schema.notificationFilters }),
    controller.list,
  );
  router.get(
    '/notifications/unread-count',
    authenticate,
    anyAuthenticated(),
    validate({ query: empty }),
    controller.count,
  );
  router.post(
    '/notifications/read-all',
    authenticate,
    anyAuthenticated(),
    validate({ query: empty, body: empty }),
    controller.readAll,
  );
  router.post(
    '/notifications/:id/read',
    authenticate,
    anyAuthenticated(),
    validate({ params, query: empty, body: empty }),
    controller.read,
  );
  return router;
}
