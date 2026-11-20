// Read-only answers about assignments for other modules. The assignments module itself (proposals,
// approvals) comes in a later prompt.

const ACTIVE = { in: ['proposed', 'approved'] };

/** Proposed or approved assignments that `userId` supervises in the campaign. */
function countActiveForSupervisor(tx, campaignId, userId) {
  return tx.assignment.count({ where: { campaignId, supervisorId: userId, status: ACTIVE } });
}

/** Approved assignments of the campaign (BR-10: activation needs at least one). */
function countApproved(tx, campaignId) {
  return tx.assignment.count({ where: { campaignId, status: 'approved' } });
}

/** Which of `pointOfSaleIds` have a proposed or approved assignment in the campaign. */
async function pointsOfSaleWithActiveAssignments(tx, campaignId, pointOfSaleIds) {
  if (!pointOfSaleIds.length) return [];
  const rows = await tx.assignment.findMany({
    where: { campaignId, pointOfSaleId: { in: pointOfSaleIds }, status: ACTIVE },
    distinct: ['pointOfSaleId'],
    select: { pointOfSaleId: true },
  });
  return rows.map((row) => row.pointOfSaleId);
}

export const assignmentReadService = Object.freeze({
  countApproved,
  countActiveForSupervisor,
  pointsOfSaleWithActiveAssignments,
});
