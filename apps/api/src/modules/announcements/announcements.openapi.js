import * as schema from '@fieldflow/shared';
import { z } from 'zod';
import { operation } from '../../core/http/openapi.js';
const params = z.strictObject({ id: z.uuid() });
export function registerAnnouncementsOpenApi(registry) {
  registry.register(
    operation('get', '/announcements', 'List announcements', 'announcement.read', {
      query: schema.communicationPaging,
      list: true,
    }),
  );
  registry.register(
    operation('post', '/announcements', 'Publish announcements', 'announcement.publish', {
      body: schema.announcementPublish,
      status: 201,
    }),
  );
  registry.register(
    operation(
      'get',
      '/announcements/audience-preview',
      'Preview announcements',
      'announcement.publish',
      { query: schema.announcementPreview },
    ),
  );
  registry.register(
    operation('get', '/announcements/{id}', 'Open announcements', 'announcement.read', { params }),
  );
  registry.register(
    operation('get', '/announcements/{id}/reads', 'Reads announcements', 'announcement.publish', {
      params,
    }),
  );
}
