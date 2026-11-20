import { describe, expect, it } from 'vitest';
import {
  EXPECTED_COMMUNES,
  EXPECTED_WILAYAS,
  loadReferenceData,
  seedReferenceData,
} from '../../../prisma/seed/index.js';
import { prisma } from '../client.js';

const agency = { agencyName: 'Seed test agency', agencyCode: 'SEED-TEST' };

const counts = async () => ({
  agencies: await prisma.agency.count({ where: { code: agency.agencyCode } }),
  wilayas: await prisma.wilaya.count(),
  communes: await prisma.commune.count(),
});

describe('reference data seed', () => {
  it('ships exactly 69 wilayas and 1,541 communes (Law 26-06)', () => {
    const { wilayas, communes } = loadReferenceData();
    expect(wilayas).toHaveLength(EXPECTED_WILAYAS);
    expect(communes).toHaveLength(EXPECTED_COMMUNES);
    expect(new Set(communes.map((c) => c.code)).size).toBe(EXPECTED_COMMUNES);
    expect(new Set(communes.map((c) => c.wilayaId)).size).toBe(EXPECTED_WILAYAS);
  });

  it('loads 1 agency, 69 wilayas and 1,541 communes, and is idempotent', async () => {
    const first = await seedReferenceData(agency);
    expect(first).toMatchObject({ wilayas: 69, communes: 1541 });
    const afterFirst = await counts();
    expect(afterFirst).toEqual({ agencies: 1, wilayas: 69, communes: 1541 });

    const communeIds = await prisma.commune.findMany({
      select: { id: true, code: true },
      orderBy: { code: 'asc' },
    });
    await seedReferenceData(agency);
    expect(await counts()).toEqual(afterFirst);
    expect(
      await prisma.commune.findMany({ select: { id: true, code: true }, orderBy: { code: 'asc' } }),
    ).toEqual(communeIds);
  });

  it('keeps the 2026 wilaya of communes that moved (e.g. 3207 → wilaya 69)', async () => {
    await seedReferenceData(agency);
    await expect(prisma.commune.findUnique({ where: { code: '3207' } })).resolves.toMatchObject({
      wilayaId: 69,
    });
  });
});
