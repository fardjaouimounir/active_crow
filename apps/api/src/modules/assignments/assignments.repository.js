import { scoped, userWhere } from '../../core/authz/index.js';

export const liveStatuses = ['proposed', 'approved'];
export const asDate = (value) => new Date(value);
const person = { select: { id: true, fullName: true, phone: true } };
const location = {
  select: { id: true, name: true, address: true, wilayaId: true, latitude: true, longitude: true },
};
const campaignDetails = {
  wilayas: { include: { staff: true, wilaya: { select: { nameAr: true, nameEn: true } } } },
  pointsOfSale: { select: { pointOfSale: location } },
};
const rowDetails = {
  pointOfSale: location,
  animateur: { select: { ...person.select, status: true } },
  supervisor: person,
};

export async function getCampaign(db, agencyId, id, lock = false) {
  if (lock)
    await db.$queryRaw`SELECT id FROM campaigns WHERE agency_id = ${agencyId}::uuid AND id = ${id}::uuid FOR SHARE`;
  return db.campaign.findFirst({ where: { id, agencyId }, include: campaignDetails });
}

export async function getRow(db, agencyId, id, lock = false) {
  if (lock)
    await db.$queryRaw`SELECT id FROM assignments WHERE agency_id = ${agencyId}::uuid AND id = ${id}::uuid FOR UPDATE`;
  return db.assignment.findFirst({ where: { id, agencyId }, include: rowDetails });
}

export function findAnimateur(db, scope, id, agencyId) {
  return userWhere(scope, { db }).then((where) =>
    db.user.findFirst({
      where: scoped(where, { id, agencyId }),
      select: { role: true, status: true },
    }),
  );
}

export function overlap(db, agencyId, { animateurId, startDate, endDate }) {
  return db.assignment.findFirst({
    where: {
      agencyId,
      animateurId,
      status: { in: liveStatuses },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    include: { pointOfSale: location, campaign: { include: campaignDetails } },
  });
}

export const create = (db, agencyId, data) =>
  db.assignment.create({ data: { ...data, agencyId }, include: rowDetails });
export const update = (db, agencyId, id, data) =>
  db.assignment.update({ where: { id, agencyId }, data, include: rowDetails });

export function list(db, where, paging = {}) {
  return db.assignment.findMany({
    where,
    ...paging,
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    include: { ...rowDetails, campaign: { include: campaignDetails } },
  });
}

export async function candidates(db, scope, agencyId, q) {
  return db.user.findMany({
    where: scoped(await userWhere(scope, { db }), {
      agencyId,
      role: 'animateur',
      status: 'active',
      ...(q ? { fullName: { contains: q, mode: 'insensitive' } } : {}),
    }),
    select: {
      id: true,
      fullName: true,
      wilayaId: true,
      communeId: true,
      reportingLines: true,
      animateurAssignments: {
        where: { agencyId, status: 'approved' },
        select: { campaignId: true, endDate: true },
      },
    },
    orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
  });
}

export function countRows(db, where) {
  return db.assignment.count({ where });
}

export async function activePoints(db, campaignId, pointOfSaleIds) {
  if (!pointOfSaleIds.length) return [];
  const rows = await db.assignment.findMany({
    where: { campaignId, pointOfSaleId: { in: pointOfSaleIds }, status: { in: liveStatuses } },
    distinct: ['pointOfSaleId'],
    select: { pointOfSaleId: true },
  });
  return rows.map(({ pointOfSaleId }) => pointOfSaleId);
}

export async function lockUser(db, agencyId, userId) {
  await db.$queryRaw`SELECT id FROM users WHERE agency_id = ${agencyId}::uuid AND id = ${userId}::uuid FOR SHARE`;
}

export async function regionalAssignments(db, actor) {
  const staff = await db.campaignStaff.findMany({
    where: { agencyId: actor.agencyId, userId: actor.id, role: 'regional_manager' },
    select: { campaignId: true, wilayaId: true },
  });
  return staff.map(({ campaignId, wilayaId }) => ({ campaignId, pointOfSale: { wilayaId } }));
}

export function getOverlaps(db, agencyId, ids, startDate, endDate) {
  return list(db, {
    agencyId,
    animateurId: { in: ids },
    status: { in: liveStatuses },
    startDate: { lte: endDate },
    endDate: { gte: startDate },
  });
}

/** Locks the applicable assignment so it cannot be cancelled while the issue is created. */
export async function hasApprovedAssignmentOnDay(
  db,
  { agencyId, userId },
  { campaignId, pointOfSaleId, day },
) {
  const weekday = asDate(day).getUTCDay() || 7;
  const rows = await db.$queryRaw`
    SELECT id FROM assignments
    WHERE agency_id = ${agencyId}::uuid AND animateur_id = ${userId}::uuid
      AND campaign_id = ${campaignId}::uuid AND point_of_sale_id = ${pointOfSaleId}::uuid
      AND status = 'approved' AND start_date <= ${day}::date AND end_date >= ${day}::date
      AND (COALESCE(cardinality(work_days), 0) = 0 OR ${weekday}::smallint = ANY(work_days))
    FOR SHARE`;
  return rows.length > 0;
}
