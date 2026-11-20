import { prisma } from '../../src/db/client.js';

/**
 * Empties every business table, keeping the seeded reference data (wilayas, communes) and the
 * migration history. TRUNCATE does not fire the append-only row triggers. The table list is built
 * inside PostgreSQL with format('%I'), so no SQL is assembled in JavaScript.
 */
export async function truncateBusinessTables(client = prisma) {
  await client.$executeRaw`
    DO $$
    DECLARE
      tables text;
    BEGIN
      SELECT string_agg(format('%I', tablename), ', ') INTO tables
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT IN ('wilayas', 'communes', '_prisma_migrations');
      IF tables IS NOT NULL THEN
        EXECUTE 'TRUNCATE ' || tables || ' RESTART IDENTITY CASCADE';
      END IF;
    END $$`;
}
