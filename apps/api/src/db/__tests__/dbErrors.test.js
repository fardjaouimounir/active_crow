// mapDbError unit tests: one per PostgreSQL error code, for each shape the errors arrive in.
import { BUSINESS_RULE_VIOLATION, CONFLICT, INSUFFICIENT_STOCK } from '@fieldflow/shared';
import { describe, expect, it } from 'vitest';
import { AppError, NotFoundError } from '../../core/errors/index.js';
import { mapDbError, readPgError } from '../dbErrors.js';

/** Shape of a statement error from Prisma 7 + @prisma/adapter-pg. */
function prismaError(originalCode, originalMessage, constraint) {
  return Object.assign(new Error('Invalid prisma call'), {
    name: 'PrismaClientKnownRequestError',
    code: 'P2039',
    meta: {
      driverAdapterError: {
        name: 'DriverAdapterError',
        cause: {
          originalCode,
          originalMessage,
          ...(constraint && { constraint: { index: constraint } }),
        },
      },
    },
  });
}

/** Shape of an error raised at COMMIT (deferred trigger): a bare DriverAdapterError. */
function commitError(originalCode, originalMessage) {
  return Object.assign(new Error(originalMessage), {
    name: 'DriverAdapterError',
    cause: { originalCode, originalMessage, kind: 'postgres' },
  });
}

/** Shape of a pg DatabaseError. */
function pgError(code, message, constraint) {
  return Object.assign(new Error(message), { code, severity: 'ERROR', constraint });
}

describe('mapDbError', () => {
  it('23505 unique violation → 409 CONFLICT with the constraint name', () => {
    const mapped = mapDbError(
      prismaError(
        '23505',
        'duplicate key value violates unique constraint "agencies_code_key"',
        'agencies_code_key',
      ),
    );
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped).toMatchObject({
      status: 409,
      code: CONFLICT,
      details: { constraint: 'agencies_code_key' },
    });
  });

  it('23P01 exclusion violation → 409 CONFLICT (constraint read from the message)', () => {
    const mapped = mapDbError(
      prismaError(
        '23P01',
        'conflicting key value violates exclusion constraint "assignments_no_overlap"',
      ),
    );
    expect(mapped).toMatchObject({
      status: 409,
      code: CONFLICT,
      details: { constraint: 'assignments_no_overlap' },
    });
  });

  it('23514 stock balance check violation → 422 INSUFFICIENT_STOCK', () => {
    const mapped = mapDbError(
      prismaError(
        '23514',
        'new row for relation "stock_balances" violates check constraint "stock_balances_non_negative"',
      ),
    );
    expect(mapped).toMatchObject({
      status: 422,
      code: INSUFFICIENT_STOCK,
    });
  });

  it('23514 other check violations → 422 BUSINESS_RULE_VIOLATION', () => {
    const mapped = mapDbError(
      prismaError('23514', 'violates check constraint "sales_void_consistent"'),
    );
    expect(mapped).toMatchObject({
      status: 422,
      code: BUSINESS_RULE_VIOLATION,
      details: { constraint: 'sales_void_consistent' },
    });
  });

  it('23503 foreign key violation → 422 BUSINESS_RULE_VIOLATION', () => {
    const mapped = mapDbError(
      pgError('23503', 'violates foreign key constraint', 'sales_customer_id_fkey'),
    );
    expect(mapped).toMatchObject({
      status: 422,
      code: BUSINESS_RULE_VIOLATION,
      details: { constraint: 'sales_customer_id_fkey' },
    });
  });

  it('P0001 raised by a trigger → 422 with the trigger message in details.reason', () => {
    const mapped = mapDbError(commitError('P0001', 'sales is append-only'));
    expect(mapped).toMatchObject({
      status: 422,
      code: BUSINESS_RULE_VIOLATION,
      details: { reason: 'sales is append-only' },
    });
  });

  it('keeps an unbalanced ledger failure internal', () => {
    const error = commitError('P0001', 'unbalanced ledger for line 42');
    expect(mapDbError(error)).toBe(error);
  });

  it('returns any other database error unchanged (so it becomes a logged 500)', () => {
    const deadlock = prismaError('40P01', 'deadlock detected');
    expect(mapDbError(deadlock)).toBe(deadlock);
  });

  it('returns non-database errors and AppErrors unchanged', () => {
    const plain = new Error('boom');
    const appError = new NotFoundError();
    expect(mapDbError(plain)).toBe(plain);
    expect(mapDbError(appError)).toBe(appError);
    expect(mapDbError(undefined)).toBeUndefined();
  });

  it('does not mistake Prisma error codes for SQLSTATEs', () => {
    expect(readPgError(Object.assign(new Error('x'), { code: 'P2025' }))).toBeNull();
  });
});
