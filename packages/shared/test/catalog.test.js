import { describe, expect, it } from 'vitest';
import {
  createStockItemSchema,
  moneyInputSchema,
  moneySchema,
  normalizeMoneyInput,
  skuSchema,
} from '../src/index.js';

describe('moneySchema', () => {
  it('accepts decimal strings and returns them with two decimals', () => {
    expect(moneySchema.parse('1250.50')).toBe('1250.50');
    expect(moneySchema.parse('1250.5')).toBe('1250.50');
    expect(moneySchema.parse('0')).toBe('0.00');
    expect(moneySchema.parse('999999999999.99')).toBe('999999999999.99');
  });

  it('rejects floats, three decimals, negatives and out-of-range amounts', () => {
    for (const value of [1250.5, '1250.555', '-1', '1000000000000', '01', '1e3', '', ' 1']) {
      expect(moneySchema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});

describe('money input', () => {
  it.each([
    ['1250', '1250'],
    ['1250.5', '1250.5'],
    ['1 250,50', '1250.50'],
    ['1 250,50', '1250.50'],
    ['1,250.50', '1250.50'],
    ['1.250,50', '1250.50'],
    ['1,250', '1250'],
    ['١٢٥٠٫٥', '1250.5'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeMoneyInput(input)).toBe(expected);
  });

  it('turns an empty field into null and parses localised text', () => {
    expect(moneyInputSchema.parse('')).toBeNull();
    expect(moneyInputSchema.parse('1 250,5')).toBe('1250.50');
    expect(moneyInputSchema.safeParse('12,505,5').success).toBe(false);
  });
});

describe('catalog schemas', () => {
  it('upper-cases SKUs and enforces the pattern', () => {
    expect(skuSchema.parse(' mug-01 ')).toBe('MUG-01');
    expect(skuSchema.safeParse('-MUG').success).toBe(false);
    expect(skuSchema.safeParse('A'.repeat(41)).success).toBe(false);
  });

  it('is strict and limits kind to gifts and samples', () => {
    const item = { kind: 'gift', sku: 'MUG-01', name: 'Branded mug', unitLabel: 'piece' };
    expect(createStockItemSchema.safeParse(item).success).toBe(true);
    expect(createStockItemSchema.safeParse({ ...item, kind: 'plv' }).success).toBe(false);
    expect(createStockItemSchema.safeParse({ ...item, agencyId: 'x' }).success).toBe(false);
  });
});
