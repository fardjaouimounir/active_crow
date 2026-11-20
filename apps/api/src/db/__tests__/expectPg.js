// Assertion helper for database tests: the promise must be rejected by PostgreSQL itself.
import { expect } from 'vitest';
import { readPgError } from '../dbErrors.js';

/**
 * @param {Promise<unknown>} promise
 * @param {{ code: string | string[], constraint?: string, message?: RegExp }} expected
 *   `constraint` is matched against the constraint name; `message` against the database message.
 */
export async function expectPgError(promise, { code, constraint, message }) {
  const error = await promise.then(
    () => null,
    (err) => err,
  );
  expect(error, 'expected PostgreSQL to reject the operation').not.toBeNull();
  const pg = readPgError(error);
  expect(pg, `not a database error: ${error?.message}`).not.toBeNull();
  expect([code].flat()).toContain(pg.code);
  if (constraint) expect(pg.constraint).toBe(constraint);
  if (message) expect(pg.message).toMatch(message);
  return pg;
}
