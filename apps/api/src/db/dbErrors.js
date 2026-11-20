// Maps PostgreSQL errors (as surfaced by Prisma 7 + @prisma/adapter-pg, or by pg directly) to AppErrors.
// Kept free of Prisma imports so the global error handler can use it.
import { AppError } from '../core/errors/AppError.js';
import { logger } from '../config/logger.js';
import { ERROR_CODES } from '@fieldflow/shared';
import { BusinessRuleError, ConflictError } from '../core/errors/httpErrors.js';

const STOCK_BALANCE_CONSTRAINT = 'stock_balances_non_negative';
const UNBALANCED_LEDGER = /^unbalanced ledger for line (\S+)/;

export const PG_ERROR = Object.freeze({
  UNIQUE_VIOLATION: '23505',
  EXCLUSION_VIOLATION: '23P01',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  RAISE_EXCEPTION: 'P0001',
});

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const CONSTRAINT_PATTERN = /constraint "([^"]+)"/;

/**
 * Finds the PostgreSQL SQLSTATE, message and constraint name in an error, if it is a database error.
 * @param {any} err
 * @returns {{ code: string, message: string, constraint?: string } | null}
 */
export function readPgError(err) {
  // Prisma 7 driver adapters: PrismaClientKnownRequestError.meta.driverAdapterError.cause for
  // statement errors; a bare DriverAdapterError (`.cause`) for errors raised at COMMIT, such as
  // deferred constraint triggers.
  const cause = err?.meta?.driverAdapterError?.cause ?? (err?.cause?.originalCode && err.cause);
  if (cause?.originalCode) {
    const message = cause.originalMessage ?? '';
    return {
      code: cause.originalCode,
      message,
      constraint: cause.constraint?.index ?? message.match(CONSTRAINT_PATTERN)?.[1],
    };
  }
  // pg DatabaseError (e.g. a query run directly through the pg driver)
  if (typeof err?.code === 'string' && SQLSTATE_PATTERN.test(err.code) && err.severity) {
    return { code: err.code, message: err.message, constraint: err.constraint };
  }
  return null;
}

/**
 * Converts known database errors to client-safe AppErrors:
 * 23505 / 23P01 → 409 ConflictError, 23514 / 23503 → 422 BusinessRuleError,
 * P0001 (raised by our triggers) → 422 BusinessRuleError with `details.reason` = trigger message.
 * Anything else is returned unchanged, so the error handler logs it and answers a generic 500.
 * @param {unknown} err
 * @returns {unknown}
 */
export function mapDbError(err) {
  if (err instanceof AppError) return err;
  const pg = readPgError(err);
  if (!pg) return err;

  // BR-41: backstop of the engine's own check (which also reports the quantities).
  if (pg.code === PG_ERROR.CHECK_VIOLATION && pg.constraint === STOCK_BALANCE_CONSTRAINT) {
    return new AppError({
      status: 422,
      code: ERROR_CODES.INSUFFICIENT_STOCK,
      message: 'Not enough stock at this location',
    });
  }
  // The double-entry trigger firing means a bug: log it and let the handler answer a generic 500.
  const unbalanced = pg.code === PG_ERROR.RAISE_EXCEPTION && UNBALANCED_LEDGER.exec(pg.message);
  if (unbalanced) {
    logger.error({ movementLineId: unbalanced[1] }, 'Unbalanced stock ledger rejected at commit');
    return err;
  }

  const details = pg.constraint ? { constraint: pg.constraint } : undefined;
  switch (pg.code) {
    case PG_ERROR.UNIQUE_VIOLATION:
      return new ConflictError('A record with the same values already exists', details);
    case PG_ERROR.EXCLUSION_VIOLATION:
      return new ConflictError('The record overlaps an existing one', details);
    case PG_ERROR.CHECK_VIOLATION:
      return new BusinessRuleError('The data violates a business rule', details);
    case PG_ERROR.FOREIGN_KEY_VIOLATION:
      return new BusinessRuleError(
        'A referenced record does not exist or is still referenced',
        details,
      );
    case PG_ERROR.RAISE_EXCEPTION:
      return new BusinessRuleError('The operation is not allowed', { reason: pg.message });
    default:
      return err;
  }
}
