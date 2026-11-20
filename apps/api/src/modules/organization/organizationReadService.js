// Read-only answers about people and points of sale for other modules (campaign staffing and
// coverage). Agency-bound through the scope; no other module queries these tables directly.

/** A user of the scope's agency with their account role and status, or null. */
function findUser(db, scope, userId) {
  return db.user.findFirst({
    where: { id: userId, agencyId: scope.agencyId },
    select: { id: true, fullName: true, role: true, status: true },
  });
}

/** Active (non-deleted) points of sale of the agency among `ids`, with their wilaya. */
function findPointsOfSale(db, scope, ids) {
  if (!ids.length) return [];
  return db.pointOfSale.findMany({
    where: { id: { in: ids }, agencyId: scope.agencyId, deletedAt: null },
    select: { id: true, code: true, name: true, wilayaId: true },
  });
}

export const organizationReadService = Object.freeze({ findUser, findPointsOfSale });
