import { ScopeService } from '../../core/authz/scopeService.js';
import { campaignWhere } from '../../core/authz/scopeFilters.js';
import { can } from '@fieldflow/shared';
import { registerFileAccessPolicy } from '../files/fileAccessPolicies.js';
import { subscribe } from '../notifications/subscriptions.js';
import * as repository from './attendance.repository.js';
import { dateText } from './expected.js';

registerFileAccessPolicy('attendance_photo', async (actor, file, db) => {
  if (!can(actor.role, 'attendance.read')) return null;
  const scope = ScopeService.resolve(actor);
  const [row] = await repository.records(db, scope, { photoFileId: file.id }, 1);
  return row &&
    (await repository.assignmentVisible(db, scope, row.assignment, dateText(row.workDate)))
    ? {}
    : null;
});

registerFileAccessPolicy('visit_photo', async (actor, file, db) => {
  if (actor.role === 'client') {
    // Only photos the agency chose to share, of a campaign in the client scope.
    if (file.visibility !== 'client_visible') return null;
    const scope = ScopeService.resolve(actor);
    const link = await db.visitPhoto.findFirst({
      where: { fileId: file.id, visit: { campaign: campaignWhere(scope) } },
      select: { fileId: true },
    });
    return link ? {} : null;
  }
  if (!can(actor.role, 'visit.read')) return null;
  const scope = ScopeService.resolve(actor);
  const [row] = await repository.visits(db, scope, { photos: { some: { fileId: file.id } } });
  return row ? {} : null;
});

subscribe('attendance.rejected', async (_tx, { payload }) => ({
  userIds: [payload.animateurId],
  entityType: 'attendance',
  entityId: payload.attendanceId,
  payload: { campaignId: payload.campaignId, reason: payload.reason },
}));
