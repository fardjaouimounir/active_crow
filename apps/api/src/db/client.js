// The only module that imports @prisma/client (enforced by ESLint). Repositories use `prisma` from here.
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Prisma 7 driver adapters use the pg driver's own pool defaults, so the pool is configured explicitly.
 * @type {import('pg').PoolConfig}
 */
export const POOL_SETTINGS = Object.freeze({
  max: 10,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

const HEALTH_CHECK_TIMEOUT_MS = 3_000;

/**
 * @param {{ url: string, pool?: import('pg').PoolConfig }} options
 * @returns {PrismaClient}
 */
export function createPrismaClient({ url, pool = POOL_SETTINGS }) {
  // Prisma events go through pino (structured, redacted, silent in tests by default).
  // Tests only record errors; other environments also record warnings.
  const levels = env.NODE_ENV === 'test' ? ['error'] : ['warn', 'error'];
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, ...pool }),
    log: levels.map((level) => ({ emit: 'event', level })),
  });
  for (const level of levels) {
    client.$on(level, (event) =>
      logger[level]({ target: event.target }, `prisma: ${event.message}`),
    );
  }
  return client;
}

/** Tests run against the dedicated test database. */
export const databaseUrl = env.NODE_ENV === 'test' ? env.DATABASE_URL_TEST : env.DATABASE_URL;

export const prisma = createPrismaClient({ url: databaseUrl });

/**
 * `true` when the database answers `SELECT 1` within a few seconds.
 * @param {PrismaClient} [client]
 */
export async function pingDatabase(client = prisma) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS);
  });
  const query = client.$queryRaw`SELECT 1`.then(
    () => true,
    () => false,
  );
  try {
    return await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function disconnectDatabase(client = prisma) {
  await client.$disconnect();
}
