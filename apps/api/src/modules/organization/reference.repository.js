import { prisma } from '../../db/client.js';

const select = { id: true, nameAr: true, nameEn: true };

export function listWilayas() {
  return prisma.wilaya.findMany({ select, orderBy: { id: 'asc' } });
}

export async function findWilayaCommunes(id) {
  const wilaya = await prisma.wilaya.findUnique({
    where: { id },
    select: {
      communes: { select: { ...select, code: true, wilayaId: true }, orderBy: { code: 'asc' } },
    },
  });
  return wilaya?.communes;
}
