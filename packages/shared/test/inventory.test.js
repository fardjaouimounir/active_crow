import { describe, expect, it } from 'vitest';
import {
  adjustmentBody,
  confirmBody,
  reconciliationCheck,
  resolveBody,
  returnBody,
  transferBody,
} from '../src/index.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('stock schemas', () => {
  it('reject zero, fractional, duplicate and oversized lines and unknown keys', () => {
    const base = { recipientUserId: id };
    const ok = (lines) => transferBody.safeParse({ ...base, lines }).success;
    expect(ok([{ stockItemId: id, quantity: 1 }])).toBe(true);
    expect(ok([{ stockItemId: id, quantity: 0 }])).toBe(false);
    expect(ok([{ stockItemId: id, quantity: 1.5 }])).toBe(false);
    expect(ok([{ stockItemId: id, quantity: 100_001 }])).toBe(false);
    expect(
      ok([
        { stockItemId: id, quantity: 1 },
        { stockItemId: id, quantity: 2 },
      ]),
    ).toBe(false);
    expect(ok([])).toBe(false);
    expect(transferBody.safeParse({ ...base, lines: [], agencyId: id }).success).toBe(false);
  });

  it('returns need a recipient for a person and a reference for the client', () => {
    const lines = [{ stockItemId: id, quantity: 1 }];
    expect(returnBody.safeParse({ destination: 'user', lines }).success).toBe(false);
    expect(
      returnBody.safeParse({ destination: 'user', recipientUserId: other, lines }).success,
    ).toBe(true);
    expect(returnBody.safeParse({ destination: 'client', lines }).success).toBe(false);
    expect(returnBody.safeParse({ destination: 'client', reference: 'R', lines }).success).toBe(
      true,
    );
    expect(
      returnBody.safeParse({ destination: 'warehouse', recipientUserId: other, lines }).success,
    ).toBe(false);
  });

  it('a loss needs a reason; adjustments need a note of 3 to 500 characters', () => {
    const lines = [{ stockItemId: id, decision: 'loss' }];
    expect(resolveBody.safeParse({ lines }).success).toBe(false);
    expect(resolveBody.safeParse({ lines, note: 'Lost on the road' }).success).toBe(true);
    const adjustment = { reason: 'damaged', lines: [{ stockItemId: id, quantity: 1 }] };
    expect(adjustmentBody.safeParse({ ...adjustment, note: 'ab' }).success).toBe(false);
    expect(adjustmentBody.safeParse({ ...adjustment, note: 'Water' }).success).toBe(true);
    expect(
      adjustmentBody.safeParse({ ...adjustment, reason: 'found', note: 'Water' }).success,
    ).toBe(false);
    expect(
      confirmBody.safeParse({ lines: [{ stockItemId: id, quantityReceived: 0 }] }).success,
    ).toBe(true);
  });
});

describe('FR-083 reconciliation check', () => {
  const row = { received: 100, sent: 40, returned: 10, distributed: 20, adjusted: 5, balance: 25 };
  it('passes when received − sent − returned − distributed − adjusted = balance', () => {
    expect(reconciliationCheck(row)).toEqual({ ok: true, difference: 0 });
  });
  it('reports the difference when it does not', () => {
    expect(reconciliationCheck({ ...row, balance: 27 })).toEqual({ ok: false, difference: 2 });
  });
});
