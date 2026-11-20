import { subscribe } from '../notifications/subscriptions.js';

subscribe('campaign.status_changed', async (tx, { payload: { agencyId, campaignId, status } }) => {
  const staff = await tx.campaignStaff.findMany({
    where: { agencyId, campaignId },
    select: { userId: true },
  });
  const assignments = ['active', 'suspended', 'completed', 'cancelled'].includes(status)
    ? await tx.assignment.findMany({
        where: { agencyId, campaignId, status: 'approved' },
        select: { animateurId: true },
      })
    : [];
  return {
    userIds: [
      ...staff.map(({ userId }) => userId),
      ...assignments.map(({ animateurId }) => animateurId),
    ],
    entityType: 'campaign',
    entityId: campaignId,
    payload: { status },
  };
});
