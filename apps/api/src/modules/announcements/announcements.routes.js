import * as schema from '@fieldflow/shared';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../core/auth/index.js';
import { requirePermission } from '../../core/authz/index.js';

import { validate } from '../../core/http/index.js';
import * as controller from './announcements.controller.js';
const params = z.strictObject({ id: z.uuid() });
const empty = z.strictObject({});

export function createAnnouncementsRouter() {
  const router = Router();
  router.get(
    '/announcements',
    authenticate,
    requirePermission('announcement.read'),
    validate({ query: schema.communicationPaging }),
    controller.list,
  );
  router.post(
    '/announcements',
    authenticate,
    requirePermission('announcement.publish'),
    validate({ query: empty, body: schema.announcementPublish }),
    controller.publish,
  );
  router.get(
    '/announcements/audience-preview',
    authenticate,
    requirePermission('announcement.publish'),
    validate({ query: schema.announcementPreview }),
    controller.preview,
  );
  router.get(
    '/announcements/:id',
    authenticate,
    requirePermission('announcement.read'),
    validate({ params, query: empty }),
    controller.open,
  );
  router.get(
    '/announcements/:id/reads',
    authenticate,
    requirePermission('announcement.publish'),
    validate({ params, query: empty }),
    controller.reads,
  );
  return router;
}
