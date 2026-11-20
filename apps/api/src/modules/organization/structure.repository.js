import { prisma } from '../../db/client.js';

const active = (scope) => ({ agencyId: scope.agencyId, deletedAt: null });
const area = { id: true, nameAr: true, nameEn: true };
const regionFields = {
  id: true,
  name: true,
  code: true,
  wilayas: {
    orderBy: { wilayaId: 'asc' },
    select: { wilaya: { select: area } },
  },
};

export function listRegions(scope) {
  return prisma.region.findMany({
    where: active(scope),
    select: regionFields,
    orderBy: { name: 'asc' },
  });
}

export function region(db, scope, id) {
  return db.region.findFirst({ where: { ...active(scope), id }, select: regionFields });
}

export function createRegion(tx, scope, data) {
  return tx.region.create({ data: { ...data, agencyId: scope.agencyId }, select: regionFields });
}

export function updateRegion(tx, scope, id, data) {
  return tx.region.update({ where: { ...active(scope), id }, data, select: regionFields });
}

export async function setWilayas(tx, scope, regionId, wilayaIds) {
  await tx.regionWilaya.deleteMany({
    where: { agencyId: scope.agencyId, regionId, wilayaId: { notIn: wilayaIds } },
  });
  for (const wilayaId of wilayaIds) {
    await tx.regionWilaya.upsert({
      where: { regionId_wilayaId: { regionId, wilayaId } },
      create: { agencyId: scope.agencyId, regionId, wilayaId },
      update: {},
    });
  }
}

const posFields = {
  id: true,
  code: true,
  name: true,
  type: true,
  wilayaId: true,
  communeId: true,
  address: true,
  latitude: true,
  longitude: true,
  contactName: true,
  contactPhone: true,
  version: true,
};

function serializePoint(row) {
  if (!row) return row;
  return {
    ...row,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  };
}

export async function point(db, scope, id) {
  return serializePoint(
    await db.pointOfSale.findFirst({ where: { ...active(scope), id }, select: posFields }),
  );
}

export async function listPoints(scope, { wilayaId, communeId, type, q, page, pageSize, sort }) {
  const where = {
    ...active(scope),
    wilayaId,
    communeId,
    type,
    OR: q
      ? ['name', 'code', 'address'].map((key) => ({ [key]: { contains: q, mode: 'insensitive' } }))
      : undefined,
  };
  const [field, direction] = sort.split(':');
  const [data, total] = await prisma.$transaction(
    [
      prisma.pointOfSale.findMany({
        where,
        select: posFields,
        orderBy: [{ [field]: direction }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.pointOfSale.count({ where }),
    ],
    { isolationLevel: 'RepeatableRead' },
  );
  return { data: data.map(serializePoint), meta: { page, pageSize, total } };
}

export async function createPoint(tx, scope, data) {
  return serializePoint(
    await tx.pointOfSale.create({ data: { ...data, agencyId: scope.agencyId }, select: posFields }),
  );
}

export function updatePoint(tx, scope, id, version, data) {
  return tx.pointOfSale.updateMany({
    where: { ...active(scope), id, version },
    data: { ...data, version: { increment: 1 } },
  });
}

export async function linkedToActiveCampaign(tx, scope, id) {
  const match = await tx.campaignPointOfSale.findFirst({
    where: {
      agencyId: scope.agencyId,
      pointOfSaleId: id,
      campaign: { status: { notIn: ['closed', 'cancelled'] } },
    },
    select: { campaignId: true },
  });
  return Boolean(match);
}
