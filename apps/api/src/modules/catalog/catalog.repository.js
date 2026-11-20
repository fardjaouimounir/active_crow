import { prisma } from '../../db/client.js';

/** Campaign statuses that no longer hold on to catalog entries. */
const FINISHED = ['closed', 'cancelled'];
const unfinished = { status: { notIn: FINISHED } };
const active = (scope, where = {}) => ({ agencyId: scope.agencyId, deletedAt: null, ...where });

const clientFields = {
  id: true,
  name: true,
  legalName: true,
  contactName: true,
  contactEmail: true,
  contactPhone: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      products: { where: { deletedAt: null } },
      stockItems: { where: { deletedAt: null } },
    },
  },
};
const productFields = {
  id: true,
  clientId: true,
  sku: true,
  name: true,
  unitLabel: true,
  referencePrice: true,
  createdAt: true,
  updatedAt: true,
};
const stockItemFields = {
  id: true,
  clientId: true,
  kind: true,
  sku: true,
  name: true,
  unitLabel: true,
  createdAt: true,
  updatedAt: true,
};

function serializeClient(row) {
  if (!row) return row;
  const { _count, ...client } = row;
  return { ...client, counts: { products: _count.products, stockItems: _count.stockItems } };
}

/** Decimal columns leave the repository as decimal strings (CLAUDE.md §6). */
function serializeProduct(row) {
  if (!row) return row;
  return { ...row, referencePrice: row.referencePrice?.toFixed(2) ?? null };
}

async function page(model, { where, select, orderBy, page, pageSize }, serialize) {
  const [rows, total] = await prisma.$transaction(
    [
      prisma[model].findMany({
        where,
        select,
        orderBy: [orderBy, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma[model].count({ where }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  return { data: rows.map(serialize), meta: { page, pageSize, total } };
}

const order = (sort) => {
  const [field, direction] = sort.split(':');
  return { [field]: direction };
};

export function listClients(scope, { q, sort, ...paging }) {
  const where = active(scope, {
    OR: q
      ? ['name', 'legalName', 'contactName'].map((field) => ({
          [field]: { contains: q, mode: 'insensitive' },
        }))
      : undefined,
  });
  return page(
    'client',
    { where, select: clientFields, orderBy: order(sort), ...paging },
    serializeClient,
  );
}

export async function findClient(db, scope, id) {
  return serializeClient(
    await db.client.findFirst({ where: active(scope, { id }), select: clientFields }),
  );
}

export async function createClient(tx, scope, data) {
  return serializeClient(
    await tx.client.create({ data: { ...data, agencyId: scope.agencyId }, select: clientFields }),
  );
}

export async function updateClient(tx, scope, id, data) {
  return serializeClient(
    await tx.client.update({ where: active(scope, { id }), data, select: clientFields }),
  );
}

export async function clientInUse(tx, scope, clientId) {
  const campaign = await tx.campaign.findFirst({
    where: { agencyId: scope.agencyId, clientId, ...unfinished },
    select: { id: true },
  });
  return Boolean(campaign);
}

export function listProducts(scope, clientId, { sort, ...paging }) {
  return page(
    'product',
    { where: active(scope, { clientId }), select: productFields, orderBy: order(sort), ...paging },
    serializeProduct,
  );
}

export async function findProduct(db, scope, clientId, id) {
  return serializeProduct(
    await db.product.findFirst({ where: active(scope, { clientId, id }), select: productFields }),
  );
}

export async function createProduct(tx, scope, clientId, data) {
  return serializeProduct(
    await tx.product.create({
      data: { ...data, clientId, agencyId: scope.agencyId },
      select: productFields,
    }),
  );
}

export async function updateProduct(tx, scope, clientId, id, data) {
  return serializeProduct(
    await tx.product.update({
      where: active(scope, { clientId, id }),
      data,
      select: productFields,
    }),
  );
}

export async function productInUse(tx, scope, productId) {
  const link = await tx.campaignProduct.findFirst({
    where: { agencyId: scope.agencyId, productId, campaign: unfinished },
    select: { campaignId: true },
  });
  return Boolean(link);
}

export function listStockItems(scope, clientId, { kind, sort, ...paging }) {
  return page(
    'stockItem',
    {
      where: active(scope, { clientId, kind }),
      select: stockItemFields,
      orderBy: order(sort),
      ...paging,
    },
    (row) => row,
  );
}

export function findStockItem(db, scope, clientId, id) {
  return db.stockItem.findFirst({
    where: active(scope, { clientId, id }),
    select: stockItemFields,
  });
}

export function createStockItem(tx, scope, clientId, data) {
  return tx.stockItem.create({
    data: { ...data, clientId, agencyId: scope.agencyId },
    select: stockItemFields,
  });
}

export function updateStockItem(tx, scope, clientId, id, data) {
  return tx.stockItem.update({
    where: active(scope, { clientId, id }),
    data,
    select: stockItemFields,
  });
}

/** Locations that physically hold stock; external, customers and losses are bookkeeping counterparts. */
const PHYSICAL_LOCATIONS = ['warehouse', 'holder', 'in_transit'];

/**
 * A gift or sample is in use while a physical location holds a non-zero balance of it, or while it
 * is the gift of a promotion tier in a rule set that is not superseded, in an unfinished campaign.
 */
export async function stockItemInUse(tx, scope, stockItemId) {
  // Sequential: queries on one transaction connection must not run concurrently.
  const balance = await tx.stockBalance.findFirst({
    where: {
      agencyId: scope.agencyId,
      stockItemId,
      locationKind: { in: PHYSICAL_LOCATIONS },
      quantity: { not: 0 },
    },
    select: { locationId: true },
  });
  if (balance) return true;
  const tier = await tx.promotionTier.findFirst({
    where: {
      agencyId: scope.agencyId,
      stockItemId,
      promotion: { ruleSet: { status: { not: 'superseded' }, campaign: unfinished } },
    },
    select: { id: true },
  });
  return Boolean(tier);
}
