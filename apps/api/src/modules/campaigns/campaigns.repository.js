import { campaignWhere, scoped } from '../../core/authz/index.js';
import { prisma } from '../../db/client.js';

/** Q-13: the fixed stock locations every campaign has from creation (holders come later). */
export const FIXED_STOCK_LOCATIONS = Object.freeze([
  'external',
  'warehouse',
  'in_transit',
  'customers',
  'losses',
]);

export const toDate = (iso) => new Date(iso + 'T00:00:00.000Z');
const isoDate = (date) => date.toISOString().slice(0, 10);

const listFields = {
  id: true,
  code: true,
  name: true,
  description: true,
  status: true,
  startDate: true,
  endDate: true,
  budgetAmount: true,
  assignmentApproverRole: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true } },
  wilayas: { select: { requiredAnimateurs: true } },
};

const person = { select: { id: true, fullName: true, role: true } };
const detailFields = {
  ...listFields,
  wilayas: {
    orderBy: { wilayaId: 'asc' },
    select: {
      wilayaId: true,
      requiredAnimateurs: true,
      wilaya: { select: { nameAr: true, nameEn: true } },
      staff: {
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, role: true, wilayaId: true, requiredAnimateurs: true, user: person },
      },
    },
  },
  pointsOfSale: {
    orderBy: { pointOfSale: { name: 'asc' } },
    select: { pointOfSale: { select: { id: true, code: true, name: true, wilayaId: true } } },
  },
  products: {
    orderBy: { product: { name: 'asc' } },
    select: { product: { select: { id: true, sku: true, name: true } } },
  },
  _count: { select: { documents: true } },
};

function serialize(row) {
  if (!row) return row;
  const { wilayas, budgetAmount, startDate, endDate, ...campaign } = row;
  return {
    ...campaign,
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
    budgetAmount: budgetAmount?.toFixed(2) ?? null,
    requiredAnimateurs: wilayas.reduce((sum, item) => sum + item.requiredAnimateurs, 0),
    wilayas,
  };
}

function serializeDetail(row) {
  if (!row) return row;
  const { pointsOfSale, products, _count, ...rest } = serialize(row);
  const staff = rest.wilayas.flatMap((item) => item.staff);
  return {
    ...rest,
    pointsOfSale: pointsOfSale.map((item) => item.pointOfSale),
    products: products.map((item) => item.product),
    counts: {
      wilayas: rest.wilayas.length,
      requiredAnimateurs: rest.requiredAnimateurs,
      staff: staff.length,
      pointsOfSale: pointsOfSale.length,
      products: products.length,
      documents: _count.documents,
    },
  };
}

/**
 * `CMP-{YYYY}-{NNN}`, next number for the agency and year. The transaction-scoped advisory lock
 * makes concurrent creations wait for each other; run it in a READ COMMITTED transaction so the
 * query after the lock sees the codes committed meanwhile.
 */
export async function nextCampaignCode(tx, agencyId, year) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${agencyId}::text), ${year}::int)) AS lock`;
  const [{ next }] = await tx.$queryRaw`
    SELECT (COALESCE(MAX(substring(code FROM 10)::int), 0) + 1)::int AS next
    FROM campaigns
    WHERE agency_id = ${agencyId}::uuid AND code ~ ('^CMP-' || ${String(year)} || '-[0-9]+$')`;
  return 'CMP-' + year + '-' + String(next).padStart(3, '0');
}

/**
 * Inserts a draft campaign with its first status-history row, the five fixed stock locations and an
 * empty draft rule set v1 (filled by the rules prompt).
 */
export async function insertDraftCampaign(tx, scope, data, changedById) {
  const code = await nextCampaignCode(tx, scope.agencyId, Number(data.startDate.slice(0, 4)));
  const { agencyId } = scope;
  const campaign = await tx.campaign.create({
    data: {
      ...data,
      agencyId,
      code,
      status: 'draft',
      startDate: toDate(data.startDate),
      endDate: toDate(data.endDate),
    },
    select: { id: true },
  });
  const campaignId = campaign.id;
  await tx.campaignStatusHistory.create({
    data: { agencyId, campaignId, fromStatus: null, toStatus: 'draft', changedById },
  });
  await tx.stockLocation.createMany({
    data: FIXED_STOCK_LOCATIONS.map((kind) => ({ agencyId, campaignId, kind })),
  });
  await tx.ruleSet.create({ data: { agencyId, campaignId, version: 1, status: 'draft' } });
  return findCampaign(tx, scope, campaignId);
}

export async function listCampaigns(
  scope,
  { status, clientId, wilayaId, from, to, q, sort, page, pageSize },
) {
  const where = scoped(campaignWhere(scope), {
    status,
    clientId,
    wilayas: wilayaId ? { some: { wilayaId } } : undefined,
    startDate: to ? { lte: toDate(to) } : undefined,
    endDate: from ? { gte: toDate(from) } : undefined,
    OR: q
      ? ['name', 'code'].map((field) => ({ [field]: { contains: q, mode: 'insensitive' } }))
      : undefined,
  });
  const [field, direction] = sort.split(':');
  const [rows, total] = await prisma.$transaction(
    [
      prisma.campaign.findMany({
        where,
        select: listFields,
        orderBy: [{ [field]: direction }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.campaign.count({ where }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  return {
    data: rows.map(serialize).map(({ wilayas: _wilayas, ...campaign }) => campaign),
    meta: { page, pageSize, total },
  };
}

export async function findCampaign(db, scope, id) {
  return serializeDetail(
    await db.campaign.findFirst({
      where: scoped(campaignWhere(scope), { id }),
      select: detailFields,
    }),
  );
}

/** Locks the campaign row for the rest of the transaction (coverage edits, later transitions). */
export async function lockCampaign(tx, scope, id) {
  const [row] = await tx.$queryRaw`
    SELECT id, status::text AS status, client_id AS "clientId", version,
           start_date::text AS "startDate", end_date::text AS "endDate"
    FROM campaigns
    WHERE id = ${id}::uuid AND agency_id = ${scope.agencyId}::uuid
    FOR UPDATE`;
  return row ?? null;
}

export function updateCampaign(tx, scope, id, version, data) {
  return tx.campaign.updateMany({
    where: { id, agencyId: scope.agencyId, version },
    data: {
      ...data,
      ...(data.startDate ? { startDate: toDate(data.startDate) } : {}),
      ...(data.endDate ? { endDate: toDate(data.endDate) } : {}),
      version: { increment: 1 },
    },
  });
}

export function campaignWilayas(tx, campaignId) {
  return tx.campaignWilaya.findMany({
    where: { campaignId },
    select: { wilayaId: true, requiredAnimateurs: true },
  });
}

export async function knownWilayaIds(tx, ids) {
  const rows = await tx.wilaya.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** Per removed wilaya: staff and linked points of sale still there. */
export async function wilayaUsage(tx, campaignId, wilayaIds) {
  if (!wilayaIds.length) return [];
  const staff = await tx.campaignStaff.groupBy({
    by: ['wilayaId'],
    where: { campaignId, wilayaId: { in: wilayaIds } },
    _count: { _all: true },
  });
  const points = await tx.campaignPointOfSale.findMany({
    where: { campaignId, pointOfSale: { wilayaId: { in: wilayaIds } } },
    select: { pointOfSale: { select: { wilayaId: true } } },
  });
  return wilayaIds
    .map((wilayaId) => ({
      wilayaId,
      staff: staff.find((row) => row.wilayaId === wilayaId)?._count._all ?? 0,
      pointsOfSale: points.filter((row) => row.pointOfSale.wilayaId === wilayaId).length,
    }))
    .filter((row) => row.staff || row.pointsOfSale);
}

export async function replaceWilayas(tx, scope, campaignId, rows) {
  await tx.campaignWilaya.deleteMany({
    where: { campaignId, wilayaId: { notIn: rows.map((row) => row.wilayaId) } },
  });
  // The need of a wilaya is the sum of its supervisors' quotas: it is never set from here.
  for (const { wilayaId } of rows) {
    await tx.campaignWilaya.upsert({
      where: { campaignId_wilayaId: { campaignId, wilayaId } },
      create: { agencyId: scope.agencyId, campaignId, wilayaId, requiredAnimateurs: 0 },
      update: {},
    });
  }
}

export function findStaff(tx, campaignId, id) {
  return tx.campaignStaff.findFirst({
    where: { id, campaignId },
    select: { id: true, userId: true, wilayaId: true, role: true, requiredAnimateurs: true },
  });
}

export function regionalOfWilaya(tx, campaignId, wilayaId) {
  return tx.campaignStaff.findFirst({
    where: { campaignId, wilayaId, role: 'regional_manager' },
    select: { id: true },
  });
}

export function createStaff(tx, scope, data) {
  return tx.campaignStaff.create({
    data: { ...data, agencyId: scope.agencyId },
    select: { id: true, role: true, wilayaId: true, requiredAnimateurs: true, user: person },
  });
}

export function deleteStaff(tx, id) {
  return tx.campaignStaff.delete({ where: { id } });
}

export async function linkedPointOfSaleIds(tx, campaignId) {
  const rows = await tx.campaignPointOfSale.findMany({
    where: { campaignId },
    select: { pointOfSaleId: true },
  });
  return rows.map((row) => row.pointOfSaleId);
}

export async function replacePointsOfSale(tx, scope, campaignId, ids) {
  await tx.campaignPointOfSale.deleteMany({ where: { campaignId, pointOfSaleId: { notIn: ids } } });
  await tx.campaignPointOfSale.createMany({
    data: ids.map((pointOfSaleId) => ({ campaignId, pointOfSaleId, agencyId: scope.agencyId })),
    skipDuplicates: true,
  });
}

export async function linkedProductIds(tx, campaignId) {
  const rows = await tx.campaignProduct.findMany({
    where: { campaignId },
    select: { productId: true },
  });
  return rows.map((row) => row.productId);
}

export async function replaceProducts(tx, scope, campaignId, ids) {
  await tx.campaignProduct.deleteMany({ where: { campaignId, productId: { notIn: ids } } });
  await tx.campaignProduct.createMany({
    data: ids.map((productId) => ({ campaignId, productId, agencyId: scope.agencyId })),
    skipDuplicates: true,
  });
}

const documentFields = {
  fileId: true,
  label: true,
  createdAt: true,
  file: {
    select: {
      mimeType: true,
      sizeBytes: true,
      width: true,
      height: true,
      thumbnailKey: true,
      visibility: true,
      uploadedBy: { select: { id: true, fullName: true } },
    },
  },
};

function serializeDocument(row) {
  if (!row) return row;
  const { file, fileId, ...document } = row;
  const { thumbnailKey, sizeBytes, ...details } = file;
  return {
    id: fileId,
    fileId,
    ...document,
    ...details,
    sizeBytes: Number(sizeBytes),
    hasThumbnail: Boolean(thumbnailKey),
  };
}

export async function listDocuments(db, campaignId, { clientVisibleOnly }) {
  const rows = await db.campaignDocument.findMany({
    where: {
      campaignId,
      file: { deletedAt: null, ...(clientVisibleOnly ? { visibility: 'client_visible' } : {}) },
    },
    orderBy: [{ createdAt: 'desc' }, { fileId: 'asc' }],
    select: documentFields,
  });
  return rows.map(serializeDocument);
}

export async function findDocument(db, campaignId, fileId) {
  return serializeDocument(
    await db.campaignDocument.findUnique({
      where: { campaignId_fileId: { campaignId, fileId } },
      select: documentFields,
    }),
  );
}

export async function createDocument(tx, scope, data) {
  await tx.campaignDocument.create({ data: { ...data, agencyId: scope.agencyId } });
  return findDocument(tx, data.campaignId, data.fileId);
}

export async function updateDocument(tx, campaignId, fileId, label) {
  await tx.campaignDocument.update({
    where: { campaignId_fileId: { campaignId, fileId } },
    data: { label },
  });
  return findDocument(tx, campaignId, fileId);
}

export function deleteDocument(tx, campaignId, fileId) {
  return tx.campaignDocument.delete({ where: { campaignId_fileId: { campaignId, fileId } } });
}

/** The campaign documents linking `fileId`, limited to campaigns visible to the scope. */
export function documentLinks(db, scope, fileId) {
  return db.campaignDocument.findMany({
    where: { fileId, campaign: campaignWhere(scope) },
    select: { label: true },
  });
}

export async function statusHistory(db, campaignId) {
  return db.campaignStatusHistory.findMany({
    where: { campaignId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      fromStatus: true,
      toStatus: true,
      reason: true,
      createdAt: true,
      changedBy: { select: { id: true, fullName: true } },
    },
  });
}

/** Moves the campaign to `status` (the caller holds the row lock) and bumps its version. */
export function setStatus(tx, scope, id, status) {
  return tx.campaign.update({
    where: { id, agencyId: scope.agencyId },
    data: { status, version: { increment: 1 } },
    select: { id: true },
  });
}

export function insertHistory(tx, scope, data) {
  return tx.campaignStatusHistory.create({
    data: { ...data, agencyId: scope.agencyId },
    select: { id: true },
  });
}
