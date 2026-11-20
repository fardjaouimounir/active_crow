import { subscribe } from '../notifications/subscriptions.js';
import { canApproveAssignment } from './assignments.policies.js';

const names = ['proposed', 'approved', 'rejected', 'cancelled', 'ended', 'replaced'];
for (const action of names)
  subscribe('assignment.' + action, async (tx, { payload: { agencyId, assignmentId } }) => {
    const row = await tx.assignment.findFirst({
      where: { agencyId, id: assignmentId },
      include: {
        pointOfSale: { select: { wilayaId: true } },
        replacesAssignment: { select: { id: true, animateurId: true } },
        campaign: { include: { wilayas: { include: { staff: true } } } },
      },
    });
    if (!row) return;
    let userIds;
    if (action === 'proposed') {
      const users = await tx.user.findMany({
        where: {
          agencyId,
          status: 'active',
          role: { in: ['director', 'general_manager', 'regional_manager'] },
        },
        select: { id: true, role: true },
      });
      userIds = users
        .filter((user) => canApproveAssignment(user, row.campaign, row.pointOfSale.wilayaId))
        .map(({ id }) => id);
    } else if (action === 'approved' || action === 'rejected') {
      userIds = [row.proposedById, ...(action === 'approved' ? [row.animateurId] : [])];
    } else {
      userIds = [row.animateurId, row.supervisorId];
    }
    const notification = {
      userIds,
      entityType: 'assignment',
      entityId: row.id,
      payload: { campaignId: row.campaignId },
    };
    if (action !== 'replaced' || !row.replacesAssignment) return notification;
    return [
      notification,
      {
        ...notification,
        userIds: [row.replacesAssignment.animateurId],
        entityId: row.replacesAssignment.id,
      },
    ];
  });
