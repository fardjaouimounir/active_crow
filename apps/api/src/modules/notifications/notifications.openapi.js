import * as schema from '@fieldflow/shared';
import { z } from 'zod';
import { operation } from '../../core/http/openapi.js';
const params = z.strictObject({ id: z.uuid() });
export function registerNotificationsOpenApi(registry) {
  registry.register(
    operation('get', '/notifications', 'List notifications', undefined, {
      query: schema.notificationFilters,
      list: true,
    }),
  );
  registry.register(
    operation('get', '/notifications/unread-count', 'Count notifications', undefined, {}),
  );
  registry.register(
    operation('post', '/notifications/read-all', 'ReadAll notifications', undefined, {}),
  );
  registry.register(
    operation('post', '/notifications/{id}/read', 'Read notifications', undefined, { params }),
  );
}
