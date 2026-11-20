import { describe, expect, it } from 'vitest';
import { algerianPhoneSchema, today } from '../src/organization.js';

describe('organization primitives', () => {
  it.each(['0555123456', '+213555123456'])('normalizes %s to Algerian E.164', (phone) => {
    expect(algerianPhoneSchema.parse(phone)).toBe('+213555123456');
  });

  it.each(['555123456', '055512345', '+33612345678', '+2130555123456'])(
    'rejects unsupported phone number %s',
    (phone) => expect(algerianPhoneSchema.safeParse(phone).success).toBe(false),
  );

  it('rolls over the business date at local midnight in Algiers', () => {
    expect(today(new Date('2026-11-19T22:59:00Z'))).toBe('2026-11-19');
    expect(today(new Date('2026-11-19T23:00:00Z'))).toBe('2026-11-20');
  });
});
