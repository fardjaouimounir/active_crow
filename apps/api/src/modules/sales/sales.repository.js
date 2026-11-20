import { assertScope, campaignWhere, scoped, userWhere } from '../../core/authz/scopeFilters.js';

export function agencyWhere(scope) {
  return assertScope(scope) ? {} : { agencyId: scope.agencyId };
}
export const campaign = (db, scope, id) =>
  db.campaign.findFirst({ where: scoped(campaignWhere(scope), { id }) });
export const assignment = (db, scope, id) =>
  db.assignment.findFirst({
    where: scoped(agencyWhere(scope), { id }),
    include: { campaign: true },
  });

export async function lockCampaign(db, scope, id, write = false) {
  assertScope(scope);
  if (write) {
    await db.$queryRaw`SELECT id FROM campaigns WHERE id = ${id}::uuid AND agency_id = ${scope.agencyId}::uuid FOR UPDATE`;
  } else {
    await db.$queryRaw`SELECT id FROM campaigns WHERE id = ${id}::uuid AND agency_id = ${scope.agencyId}::uuid FOR SHARE`;
  }
}
export async function lockAssignment(db, scope, id) {
  assertScope(scope);
  await db.$queryRaw`SELECT id FROM assignments WHERE id = ${id}::uuid AND agency_id = ${scope.agencyId}::uuid FOR SHARE`;
  return assignment(db, scope, id);
}

export async function saleVisible(db, scope, sale) {
  if (sale.agencyId !== scope.agencyId) return false;
  switch (scope.level) {
    case 'agency':
      return true;
    case 'self':
      return sale.animateurId === scope.userId;
    case 'supervisor':
      return sale.supervisorId === scope.userId;
    case 'regional': {
      const reports = await userWhere(scope, { at: sale.workDate, reportingOnly: true, db });
      return reports.id.in.includes(sale.supervisorId);
    }
    default:
      return false;
  }
}
const person = { select: { id: true, fullName: true } };
const saleInclude = {
  animateur: person,
  supervisor: person,
  pointOfSale: { select: { id: true, name: true } },
  customer: { select: { id: true, fullName: true, phone: true, consentTombola: true } },
  items: { include: { product: { select: { id: true, name: true } } } },
  giftEntitlements: {
    include: {
      promotion: { select: { id: true, name: true } },
      stockItem: { select: { id: true, name: true } },
      distributionMovement: { select: { id: true } },
    },
  },
  tombolaEntries: {
    include: { tombola: { select: { id: true, name: true } } },
    orderBy: { entryNumber: 'asc' },
  },
};
export const sale = (db, scope, id, includeEntries = true) =>
  db.sale.findFirst({
    where: scoped(agencyWhere(scope), { id }),
    include: {
      ...saleInclude,
      tombolaEntries: includeEntries ? saleInclude.tombolaEntries : false,
    },
  });
export const sales = (db, scope, where) =>
  db.sale.findMany({
    where: scoped(agencyWhere(scope), where),
    include: { ...saleInclude, tombolaEntries: false },
    orderBy: [{ soldAt: 'desc' }, { id: 'asc' }],
  });
export async function lockSale(db, scope, id) {
  await db.$queryRaw`SELECT id FROM sales WHERE id = ${id}::uuid AND agency_id = ${scope.agencyId}::uuid FOR UPDATE`;
  return sale(db, scope, id);
}
export const createSale = (db, scope, data) =>
  db.sale.create({ data: { ...data, agencyId: scope.agencyId } });
export const productCount = (db, scope, campaignId, ids) =>
  db.campaignProduct.count({
    where: scoped(agencyWhere(scope), {
      campaignId,
      productId: { in: ids },
      product: { deletedAt: null },
    }),
  });

export async function saveCustomer(db, scope, campaignId, actorId, input, now) {
  if (!input?.phone && !input?.fullName) return null;
  const [inserted] = await db.$queryRaw`
    INSERT INTO customers (agency_id,campaign_id,created_by,full_name,phone,consent_tombola,consent_at)
    VALUES (${scope.agencyId}::uuid,${campaignId}::uuid,${actorId}::uuid,${input.fullName ?? null},
      ${input.phone ?? null},${input.consentTombola === true},${input.consentTombola ? now : null})
    ON CONFLICT (campaign_id,phone) WHERE phone IS NOT NULL DO NOTHING RETURNING id`;
  if (inserted)
    return {
      id: inserted.id,
      consentTombola: input.consentTombola === true,
      phone: input.phone,
      existing: false,
    };
  const [locked] = await db.$queryRaw`
    SELECT id FROM customers WHERE agency_id = ${scope.agencyId}::uuid AND campaign_id = ${campaignId}::uuid
    AND phone = ${input.phone} FOR UPDATE`;
  let row = await db.customer.findUniqueOrThrow({ where: { id: locked.id } });
  if (input.consentTombola && !row.consentTombola) {
    row = await db.customer.update({
      where: { id: row.id },
      data: { consentTombola: true, consentAt: now },
    });
  }
  return { ...row, existing: true };
}

export const entitlement = (db, scope, id) =>
  db.giftEntitlement.findFirst({ where: scoped(agencyWhere(scope), { id }) });
export const entitlementCount = (db, scope, campaignId, customerId, promotionId) =>
  db.giftEntitlement.count({
    where: scoped(agencyWhere(scope), {
      campaignId,
      promotionId,
      sale: { customerId },
      status: { not: 'cancelled' },
    }),
  });
export const createEntitlement = (db, scope, data) =>
  db.giftEntitlement.create({ data: { ...data, agencyId: scope.agencyId } });
export const markShortage = (db, scope, id, shortageIssueId) =>
  db.giftEntitlement.updateMany({
    where: scoped(agencyWhere(scope), { id, shortageIssueId: null, status: 'pending' }),
    data: { shortageIssueId, status: 'undelivered' },
  });
export async function voidSale(db, scope, id, data) {
  await db.sale.updateMany({ where: scoped(agencyWhere(scope), { id, status: 'recorded' }), data });
  await db.giftEntitlement.updateMany({
    where: scoped(agencyWhere(scope), {
      saleId: id,
      status: { in: ['pending', 'undelivered'] },
    }),
    data: { status: 'cancelled' },
  });
}
export const addInteraction = (db, scope, data) =>
  db.fieldInteraction.create({ data: { ...data, agencyId: scope.agencyId } });
export const interactions = (db, scope, animateurId, workDate) =>
  db.fieldInteraction.groupBy({
    by: ['kind'],
    where: scoped(agencyWhere(scope), { animateurId, workDate }),
    _sum: { count: true },
  });
export const customer = (db, scope, id) =>
  db.customer.findFirst({ where: scoped(agencyWhere(scope), { id }) });
