import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { prisma } from '../../src/db/client.js';
import { withTransaction } from '../../src/db/transaction.js';

export const EXPECTED_WILAYAS = 69;
export const EXPECTED_COMMUNES = 1541;

const readJson = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./data/${name}`, import.meta.url)), 'utf8'));

const wilayaSchema = z.object({
  id: z.number().int().min(1).max(EXPECTED_WILAYAS),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
});
const communeSchema = z.object({
  code: z.string().regex(/^\d{4}$/),
  wilayaId: z.number().int().min(1).max(EXPECTED_WILAYAS),
  nameAr: z.string().min(1),
  nameEn: z.string().min(1),
});

class SeedError extends Error {}

/** Loads and validates the reference data files; throws if they do not hold exactly 69 / 1,541 rows. */
export function loadReferenceData() {
  const wilayas = z.array(wilayaSchema).parse(readJson('wilayas.json'));
  const communes = z.array(communeSchema).parse(readJson('communes.json'));
  if (wilayas.length !== EXPECTED_WILAYAS || communes.length !== EXPECTED_COMMUNES) {
    throw new SeedError(
      `Reference data files hold ${wilayas.length} wilayas and ${communes.length} communes; ` +
        `expected ${EXPECTED_WILAYAS} and ${EXPECTED_COMMUNES}.`,
    );
  }
  return { wilayas, communes };
}

/** Upserts shared geography without creating any business data. */
export async function seedReferenceData(client = prisma) {
  const { wilayas, communes } = loadReferenceData();

  return withTransaction(
    async (tx) => {
      for (const wilaya of wilayas) {
        await tx.wilaya.upsert({
          where: { id: wilaya.id },
          create: wilaya,
          update: { nameAr: wilaya.nameAr, nameEn: wilaya.nameEn },
        });
      }

      await tx.$executeRaw`
        INSERT INTO communes (code, wilaya_id, name_ar, name_en, updated_at)
        SELECT code, wilaya_id, name_ar, name_en, now()
        FROM unnest(
          ${communes.map((c) => c.code)}::text[],
          ${communes.map((c) => c.wilayaId)}::smallint[],
          ${communes.map((c) => c.nameAr)}::text[],
          ${communes.map((c) => c.nameEn)}::text[]
        ) AS input(code, wilaya_id, name_ar, name_en)
        ON CONFLICT (code) DO UPDATE
          SET wilaya_id = EXCLUDED.wilaya_id,
              name_ar = EXCLUDED.name_ar,
              name_en = EXCLUDED.name_en,
              updated_at = now()
          WHERE (communes.wilaya_id, communes.name_ar, communes.name_en)
            IS DISTINCT FROM (EXCLUDED.wilaya_id, EXCLUDED.name_ar, EXCLUDED.name_en)`;

      const [wilayaCount, communeCount] = await Promise.all([
        tx.wilaya.count(),
        tx.commune.count(),
      ]);
      if (wilayaCount !== EXPECTED_WILAYAS || communeCount !== EXPECTED_COMMUNES) {
        throw new SeedError(
          `Database holds ${wilayaCount} wilayas and ${communeCount} communes after seeding; ` +
            `expected ${EXPECTED_WILAYAS} and ${EXPECTED_COMMUNES}. Rolled back.`,
        );
      }
      return { wilayas: wilayaCount, communes: communeCount };
    },
    { client, timeoutMs: 60_000 },
  );
}
