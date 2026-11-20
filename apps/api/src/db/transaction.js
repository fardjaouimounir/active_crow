import { beginEvents, publishEvents } from '../core/events/index.js';
import { prisma } from './client.js';
import { mapDbError } from './dbErrors.js';

export { mapDbError };

/**
 * Runs `fn` in a Prisma interactive transaction and maps database errors to AppErrors
 * (including errors raised at COMMIT by deferred constraint triggers).
 *
 * @template T
 * @param {(tx: import('@prisma/client').Prisma.TransactionClient) => Promise<T>} fn
 * @param {{
 *   isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable',
 *   timeoutMs?: number,
 *   client?: import('@prisma/client').PrismaClient,
 * }} [options]
 * @returns {Promise<T>}
 */
export async function withTransaction(
  fn,
  { isolationLevel = 'ReadCommitted', timeoutMs = 10_000, client = prisma } = {},
) {
  try {
    let batch;
    const result = await client.$transaction(
      (tx) => {
        batch = beginEvents(tx);
        return fn(tx);
      },
      { isolationLevel, timeout: timeoutMs },
    );
    publishEvents(batch);
    return result;
  } catch (err) {
    throw mapDbError(err);
  }
}
