// The Animateurs each supervisor brought to a campaign (`campaign_animateurs`), and the supervisors'
// quotas (`campaign_staff.required_animateurs`). Every query is bound to the campaign.

const person = { select: { id: true, fullName: true, phone: true, status: true, wilayaId: true } };

/** `supervisorIds` null = every supervisor of the campaign. */
export function listTeam(db, campaignId, supervisorIds = null) {
  return db.campaignAnimateur.findMany({
    where: { campaignId, ...(supervisorIds ? { supervisorId: { in: supervisorIds } } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      supervisorId: true,
      createdAt: true,
      animateur: person,
      supervisor: { select: { id: true, fullName: true } },
    },
  });
}

export async function teamCounts(db, campaignId) {
  const rows = await db.campaignAnimateur.groupBy({
    by: ['supervisorId'],
    where: { campaignId },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.supervisorId, row._count._all]));
}

export function countTeam(db, campaignId, supervisorId) {
  return db.campaignAnimateur.count({ where: { campaignId, supervisorId } });
}

export function findMember(db, campaignId, animateurId) {
  return db.campaignAnimateur.findUnique({
    where: { campaignId_animateurId: { campaignId, animateurId } },
    select: { id: true, supervisorId: true, animateurId: true },
  });
}

export async function isInTeam(db, campaignId, supervisorId, animateurId) {
  const count = await db.campaignAnimateur.count({
    where: { campaignId, supervisorId, animateurId },
  });
  return count > 0;
}

export function addMember(db, scope, data) {
  return db.campaignAnimateur.create({
    data: { ...data, agencyId: scope.agencyId },
    select: { id: true, supervisorId: true, animateur: person, createdAt: true },
  });
}

export function removeMember(db, id) {
  return db.campaignAnimateur.delete({ where: { id } });
}

/** The supervisor's staff rows in the campaign (one per wilaya they are staffed on). */
export function supervisorStaff(db, campaignId, supervisorId) {
  return db.campaignStaff.findMany({
    where: { campaignId, userId: supervisorId, role: 'supervisor' },
    select: { id: true, wilayaId: true, requiredAnimateurs: true },
  });
}

/** Wilayas of the campaign where `userId` is staffed in `role`. */
export async function staffedWilayaIds(db, campaignId, userId, role) {
  const rows = await db.campaignStaff.findMany({
    where: { campaignId, userId, role },
    select: { wilayaId: true },
  });
  return rows.map((row) => row.wilayaId);
}

export async function supervisorsOfWilayas(db, campaignId, wilayaIds) {
  const rows = await db.campaignStaff.findMany({
    where: { campaignId, role: 'supervisor', wilayaId: { in: wilayaIds } },
    select: { userId: true },
  });
  return [...new Set(rows.map((row) => row.userId))];
}

export function setQuota(db, staffId, requiredAnimateurs) {
  return db.campaignStaff.update({ where: { id: staffId }, data: { requiredAnimateurs } });
}

/** The wilaya need is the sum of its supervisors' quotas. */
export async function syncWilayaNeed(db, campaignId, wilayaId) {
  const { _sum } = await db.campaignStaff.aggregate({
    where: { campaignId, wilayaId, role: 'supervisor' },
    _sum: { requiredAnimateurs: true },
  });
  await db.campaignWilaya.update({
    where: { campaignId_wilayaId: { campaignId, wilayaId } },
    data: { requiredAnimateurs: _sum.requiredAnimateurs ?? 0 },
  });
}
