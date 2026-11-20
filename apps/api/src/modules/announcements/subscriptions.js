import { subscribe } from '../notifications/subscriptions.js';

subscribe('announcement.published', async (_tx, { payload: { announcementId, userIds } }) => ({
  userIds,
  entityType: 'announcement',
  entityId: announcementId,
  payload: {},
}));
