import { describe, expect, it } from 'vitest';
import { slotStatus } from '../src/attendance.js';

describe('slotStatus', () => {
  for (const status of ['pending', 'verified', 'rejected', undefined]) {
    for (const type of ['justified', 'unjustified', undefined]) {
      for (const voidedAt of [null, '2026-11-20T09:00:00Z']) {
        it(`combines ${status}, ${type}, voidedAt=${voidedAt}`, () => {
          const record = status ? { status, isLate: true, flags: ['late'] } : undefined;
          const absence = type ? { type, voidedAt } : undefined;
          const expected =
            type && !voidedAt && (status === 'rejected' || !status)
              ? 'absent_' + type
              : (status ?? 'not_sent');
          expect(slotStatus({}, record, absence)).toEqual({
            status: expected,
            isLate: Boolean(status),
            flags: status ? ['late'] : [],
          });
        });
      }
    }
  }
});
