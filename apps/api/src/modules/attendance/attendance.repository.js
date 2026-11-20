import { assertScope, campaignWhere, scoped, userWhere } from '../../core/authz/scopeFilters.js';
import { businessDate } from '../../core/time/clock.js';

const person = { select: { id: true, fullName: true } };
const place = {
  select: {
    id: true,
    name: true,
    wilayaId: true,
    latitude: true,
    longitude: true,
    wilaya: { select: { nameAr: true, nameEn: true } },
  },
};
export const assignmentInclude = { animateur: person, supervisor: person, pointOfSale: place };
const recordInclude = {
  assignment: { include: assignmentInclude },
  ruleSet: { include: { rules: { where: { ruleType: 'attendance' } } } },
};

export function agencyWhere(scope) {
  if (assertScope(scope)) return {};
  return scope.level === 'client' ? { id: { in: [] } } : { agencyId: scope.agencyId };
}

export function campaign(db, scope, id) {
  return db.campaign.findFirst({ where: scoped(campaignWhere(scope), { id }) });
}

export function agencyCampaign(db, scope, id) {
  return db.campaign.findFirst({ where: scoped(agencyWhere(scope), { id }) });
}

export async function lockCampaign(db, scope, id) {
  assertScope(scope);
  await db.$queryRaw`SELECT id FROM campaigns WHERE id = ${id}::uuid
    AND agency_id = ${scope.agencyId}::uuid FOR SHARE`;
}

export function assignment(db, scope, id) {
  return db.assignment.findFirst({
    where: scoped(agencyWhere(scope), { id }),
    include: { ...assignmentInclude, campaign: true },
  });
}

export function assignments(db, scope, where) {
  return db.assignment.findMany({
    where: scoped(agencyWhere(scope), where),
    include: assignmentInclude,
    orderBy: [{ animateur: { fullName: 'asc' } }, { id: 'asc' }],
  });
}

export function records(
  db,
  scope,
  where,
  limit,
  orderBy = [{ recordedAt: 'desc' }, { id: 'asc' }],
) {
  return db.attendanceRecord.findMany({
    where: scoped(agencyWhere(scope), where),
    include: recordInclude,
    omit: { aiFlags: true },
    orderBy,
    take: limit,
  });
}

export const record = async (db, scope, id) => (await records(db, scope, { id }, 1))[0];

export async function lockRecord(db, scope, id) {
  assertScope(scope);
  await db.$queryRaw`SELECT id FROM attendance_records WHERE id = ${id}::uuid
    AND agency_id = ${scope.agencyId}::uuid FOR UPDATE`;
  return record(db, scope, id);
}

export async function assignmentVisible(db, scope, row, day) {
  switch (scope.level) {
    case 'agency':
      return true;
    case 'self':
      return row.animateurId === scope.userId;
    case 'supervisor':
      return row.supervisorId === scope.userId;
    case 'regional': {
      const supervisor = await userWhere(scope, { at: day, reportingOnly: true, db });
      return Boolean(
        await db.user.findFirst({ where: scoped(supervisor, { id: row.supervisorId }) }),
      );
    }
    default:
      return false;
  }
}

export async function lockAssignment(db, scope, id) {
  assertScope(scope);
  await db.$queryRaw`SELECT id FROM assignments WHERE id = ${id}::uuid
    AND agency_id = ${scope.agencyId}::uuid FOR UPDATE`;
  return assignment(db, scope, id);
}

export const absences = (db, scope, where) =>
  db.absence.findMany({ where: scoped(agencyWhere(scope), where), orderBy: { createdAt: 'asc' } });
export const createAbsence = (db, scope, data) =>
  db.absence.create({ data: { ...data, agencyId: scope.agencyId } });
export const voidAbsence = (db, scope, id, data) =>
  db.absence.updateMany({ where: scoped(agencyWhere(scope), { id, voidedAt: null }), data });
export const createRecord = (db, scope, data) =>
  db.attendanceRecord.create({
    data: { ...data, agencyId: scope.agencyId },
    include: recordInclude,
    omit: { aiFlags: true },
  });
export const updateRecord = (db, scope, id, status, data) =>
  db.attendanceRecord.updateMany({ where: scoped(agencyWhere(scope), { id, status }), data });
export const history = (db, scope, entityType, entityId) =>
  db.auditLog.findMany({
    where: scoped(agencyWhere(scope), { entityType, entityId }),
    orderBy: { id: 'asc' },
    select: { action: true, actorId: true, before: true, after: true, createdAt: true },
  });
export const campaignStatus = (db, scope, campaignId) =>
  db.campaignStatusHistory.findMany({
    where: scoped(agencyWhere(scope), { campaignId }),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

export async function visitPoint(db, scope, campaignId, pointOfSaleId) {
  const row = await db.campaignPointOfSale.findFirst({
    where: scoped(agencyWhere(scope), {
      campaignId,
      pointOfSaleId,
      pointOfSale: { deletedAt: null },
    }),
    include: { pointOfSale: place },
  });
  if (!row || scope.level !== 'regional') return row;
  const staff = await db.campaignStaff.findFirst({
    where: scoped(agencyWhere(scope), {
      campaignId,
      wilayaId: row.pointOfSale.wilayaId,
      userId: scope.userId,
      role: 'regional_manager',
    }),
  });
  return staff ? row : null;
}

export function visitPoints(db, scope, campaignId) {
  const region =
    scope.level === 'regional'
      ? {
          campaign: {
            wilayas: {
              some: { staff: { some: { userId: scope.userId, role: 'regional_manager' } } },
            },
          },
        }
      : {};
  return db.campaignPointOfSale.findMany({
    where: scoped(agencyWhere(scope), { campaignId, pointOfSale: { deletedAt: null }, ...region }),
    include: { pointOfSale: place },
  });
}

const visitInclude = {
  pointOfSale: place,
  supervisor: person,
  photos: true,
  issues: { select: { id: true, category: true, title: true, status: true, description: true } },
};

export async function visits(db, scope, where) {
  const visibility =
    scope.level === 'supervisor'
      ? { supervisorId: scope.userId }
      : ['agency', 'regional'].includes(scope.level)
        ? {}
        : { id: { in: [] } };
  const rows = await db.supervisorVisit.findMany({
    where: scoped(scoped(agencyWhere(scope), visibility), where),
    include: visitInclude,
    orderBy: [{ visitedAt: 'desc' }, { id: 'asc' }],
  });
  if (scope.level !== 'regional') return rows;
  const result = [];
  for (const row of rows) {
    const reports = await userWhere(scope, {
      at: businessDate(row.visitedAt),
      reportingOnly: true,
      db,
    });
    if (
      reports.id.in.includes(row.supervisorId) ||
      (await visitPoint(db, scope, row.campaignId, row.pointOfSaleId))
    ) {
      result.push(row);
    }
  }
  return result;
}

export const createVisit = (db, scope, data) =>
  db.supervisorVisit.create({ data: { ...data, agencyId: scope.agencyId }, include: visitInclude });

export const observed = (db, scope, ids) =>
  db.user.findMany({ where: scoped(agencyWhere(scope), { id: { in: ids } }), ...person });
