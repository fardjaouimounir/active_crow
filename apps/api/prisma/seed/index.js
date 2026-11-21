// Run with npm run db:seed. Pass --demo to add demo organization data.
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { disconnectDatabase, prisma } from '../../src/db/client.js';
import { demoPassword, seedDemo } from './demo.js';
import { seedReferenceData } from './reference.js';

const seedEnvSchema = z.object({
  SEED_AGENCY_NAME: z.string().trim().min(1),
  SEED_AGENCY_CODE: z.string().regex(/^[A-Z0-9-]{2,20}$/, 'must match ^[A-Z0-9-]{2,20}$'),
});

class SeedError extends Error {}

async function main() {
  const demo = process.argv.includes('--demo');
  if (demo) demoPassword(process.env);
  const env = seedEnvSchema.safeParse(process.env);
  if (!env.success) {
    throw new SeedError(
      `Invalid seed configuration:\n${env.error.issues
        .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
        .join('\n')}\nSee apps/api/.env.example.`,
    );
  }
  const { wilayas, communes } = await seedReferenceData();
  const { SEED_AGENCY_NAME: name, SEED_AGENCY_CODE: code } = env.data;
  const agency = await prisma.agency.upsert({
    where: { code },
    create: { name, code },
    update: { name },
  });
  if (demo) await seedDemo({ agency });
  process.stdout.write(
    `Seed complete: agency ${agency.code}, ${wilayas} wilayas, ${communes} communes.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    process.stderr.write(`Seed failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}
