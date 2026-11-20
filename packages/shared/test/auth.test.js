import { describe, expect, it } from 'vitest';
import {
  changePasswordBodySchema,
  loginBodySchema,
  passwordPolicyViolations,
  passwordSchema,
} from '../src/index.js';

describe('password policy', () => {
  it.each([
    ['abcdefgh12', []],
    ['كلمةسرقوية1', []],
    ['short1', ['min_length']],
    ['onlyletterspassword', ['digit']],
    ['1234567890', ['letter']],
    [`a1${'x'.repeat(127)}`, ['max_length']],
    ['', ['min_length', 'letter', 'digit']],
  ])('%j breaks %j', (value, expected) => {
    expect(passwordPolicyViolations(value)).toEqual(expected);
    const result = passwordSchema.safeParse(value);
    expect(result.success).toBe(expected.length === 0);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(expected);
    }
  });
});

describe('loginBodySchema', () => {
  it('trims and lower-cases the email', () => {
    expect(loginBodySchema.parse({ email: '  Boss@Agency.DZ ', password: 'x' })).toEqual({
      email: 'boss@agency.dz',
      password: 'x',
    });
  });

  it('rejects unknown fields, invalid emails and empty passwords', () => {
    expect(loginBodySchema.safeParse({ email: 'a@b.dz', password: 'x', role: 'x' }).success).toBe(
      false,
    );
    expect(loginBodySchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    expect(loginBodySchema.safeParse({ email: 'a@b.dz', password: '' }).success).toBe(false);
  });
});

describe('changePasswordBodySchema', () => {
  it('is strict and requires both fields', () => {
    expect(changePasswordBodySchema.safeParse({ currentPassword: 'a' }).success).toBe(false);
    expect(
      changePasswordBodySchema.safeParse({ currentPassword: 'a', newPassword: 'b', x: 1 }).success,
    ).toBe(false);
    expect(
      changePasswordBodySchema.safeParse({ currentPassword: 'a', newPassword: 'b' }).success,
    ).toBe(true);
  });
});
