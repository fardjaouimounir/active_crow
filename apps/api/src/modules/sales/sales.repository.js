import { countBuyers } from '@fieldflow/shared';
import { assertScope, campaignWhere, scoped, userWhere } from '../../core/authz/scopeFilters.js';
import { Prisma } from '../../db/client.js';

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

export async function salePage(db, scope, campaignId, filters) {
  assertScope(scope);
  const conditions = [
    Prisma.sql`s.agency_id = ${scope.agencyId}::uuid`,
    Prisma.sql`s.campaign_id = ${campaignId}::uuid`,
    Prisma.sql`s.work_date BETWEEN ${filters.from}::date AND ${filters.to}::date`,
  ];
  if (scope.level === 'self') conditions.push(Prisma.sql`s.animateur_id = ${scope.userId}::uuid`);
  if (scope.level === 'supervisor')
    conditions.push(Prisma.sql`s.supervisor_id = ${scope.userId}::uuid`);
  if (scope.level === 'client') conditions.push(Prisma.sql`false`);
  if (scope.level === 'regional')
    conditions.push(Prisma.sql`(
    s.supervisor_id = ${scope.userId}::uuid OR EXISTS (
      WITH RECURSIVE managers (user_id, depth) AS (
        SELECT s.supervisor_id, 0
        UNION ALL
        SELECT r.manager_id, m.depth + 1 FROM managers m JOIN reporting_lines r ON r.user_id = m.user_id
        WHERE m.depth < 3 AND r.agency_id = s.agency_id AND r.valid_from <= s.work_date
          AND (r.valid_to IS NULL OR r.valid_to > s.work_date)
      ) SELECT 1 FROM managers WHERE user_id = ${scope.userId}::uuid
    ))`);
  if (filters.animateurId)
    conditions.push(Prisma.sql`s.animateur_id = ${filters.animateurId}::uuid`);
  if (filters.supervisorId)
    conditions.push(Prisma.sql`s.supervisor_id = ${filters.supervisorId}::uuid`);
  if (filters.pointOfSaleId)
    conditions.push(Prisma.sql`s.point_of_sale_id = ${filters.pointOfSaleId}::uuid`);
  if (filters.status) conditions.push(Prisma.sql`s.status = ${filters.status}::sale_status`);
  if (filters.productId)
    conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM sale_items i WHERE i.sale_id = s.id AND i.product_id = ${filters.productId}::uuid)`);
  if (filters.hasUndelivered !== undefined)
    conditions.push(Prisma.sql`EXISTS (
    SELECT 1 FROM gift_entitlements g WHERE g.sale_id = s.id AND g.status = 'undelivered'
  ) = ${filters.hasUndelivered}`);
  const where = Prisma.join(conditions, ' AND ');
  const order =
    filters.sort === 'soldAt'
      ? Prisma.sql`s.sold_at ASC, s.id ASC`
      : Prisma.sql`s.sold_at DESC, s.id DESC`;
  const ids = (
    await db.$queryRaw`SELECT s.id FROM sales s WHERE ${where} ORDER BY ${order}
    LIMIT ${filters.pageSize} OFFSET ${(filters.page - 1) * filters.pageSize}`
  ).map(({ id }) => id);
  const [aggregate] = await db.$queryRaw`
    WITH matched AS (SELECT s.* FROM sales s WHERE ${where}),
    recorded AS (SELECT * FROM matched WHERE status = 'recorded')
    SELECT (SELECT count(*) FROM matched) AS total,
      (SELECT count(*) FROM recorded) AS sales,
      (SELECT coalesce(sum(i.quantity), 0) FROM sale_items i JOIN recorded r ON r.id = i.sale_id) AS units,
      (SELECT count(DISTINCT customer_id) FROM recorded) AS "identifiedBuyers",
      (SELECT count(*) FROM recorded WHERE customer_id IS NULL) AS "anonymousSales",
      (SELECT coalesce(sum(g.quantity), 0) FROM gift_entitlements g JOIN recorded r ON r.id = g.sale_id
        WHERE g.status = 'undelivered') AS undelivered,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'fullName',u.full_name)
        ORDER BY u.full_name, u.id), '[]'::jsonb) FROM users u WHERE u.id IN
        (SELECT DISTINCT animateur_id FROM matched)) AS animateurs,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'fullName',u.full_name)
        ORDER BY u.full_name, u.id), '[]'::jsonb) FROM users u WHERE u.id IN
        (SELECT DISTINCT supervisor_id FROM matched)) AS supervisors`;
  const rows = new Map((await sales(db, scope, { id: { in: ids } })).map((row) => [row.id, row]));
  const { total, animateurs, supervisors, identifiedBuyers, anonymousSales, undelivered, units } =
    aggregate;
  return {
    rows: ids.map((id) => rows.get(id)).filter(Boolean),
    total: Number(total),
    counts: {
      sales: Number(aggregate.sales),
      units: Number(units),
      buyers: countBuyers(identifiedBuyers, anonymousSales),
      undelivered: Number(undelivered),
    },
    filters: { animateurs, supervisors },
  };
}
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
export const fieldSchedule = (db, scope, day) =>
  db.assignment.findMany({
    where: scoped(agencyWhere(scope), {
      animateurId: scope.userId,
      status: 'approved',
      endDate: { gte: day },
    }),
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      startDate: true,
      endDate: true,
      workDays: true,
      shiftStart: true,
      shiftEnd: true,
      pointOfSale: { select: { id: true, name: true, address: true } },
      campaign: { select: { id: true, name: true, status: true, clientId: true } },
    },
  });
export async function fieldCatalog(db, scope, campaign) {
  const products = await db.campaignProduct.findMany({
    where: scoped(agencyWhere(scope), { campaignId: campaign.id, product: { deletedAt: null } }),
    select: { product: { select: { id: true, name: true, unitLabel: true } } },
    orderBy: [{ product: { name: 'asc' } }, { productId: 'asc' }],
  });
  const stockItems = await db.stockItem.findMany({
    where: scoped(agencyWhere(scope), { clientId: campaign.clientId, deletedAt: null }),
    select: { id: true, name: true, kind: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return { products: products.map(({ product }) => product), stockItems };
}
export const deliveredToday = (db, scope, animateurId, from, to) =>
  db.giftEntitlement.aggregate({
    where: scoped(agencyWhere(scope), {
      sale: { animateurId },
      distributionMovement: { createdAt: { gte: from, lt: to } },
    }),
    _sum: { quantity: true },
  });
export const customer = (db, scope, id) =>
  db.customer.findFirst({ where: scoped(agencyWhere(scope), { id }) });
