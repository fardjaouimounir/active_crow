import { describe, expect, it } from 'vitest';
import {
  actionsFrom,
  canEdit,
  evaluatePromotions,
  promotionSchema,
  reasonRequired,
  TRANSITIONS,
} from '../src/index.js';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const GIFT = (n) => 'bbbbbbbb-0000-4000-8000-00000000000' + n;
const P1 = 'cccccccc-0000-4000-8000-000000000001';
const P2 = 'cccccccc-0000-4000-8000-000000000002';

const tiered = (id, productId, tiers = [1, 2, 3]) => ({
  id,
  productId,
  tiers: tiers.map((min, index) => ({
    id: id + '-t' + min,
    minQuantity: min,
    stockItemId: GIFT(index + 1),
    giftQuantity: index + 1,
  })),
});

describe('evaluatePromotions', () => {
  const promotion = tiered('p1', null, [2, 4, 6]);
  const gift = (tier, stockItem, quantity) => ({
    promotionId: 'p1',
    tierId: 'p1-t' + tier,
    stockItemId: GIFT(stockItem),
    quantity,
  });

  it.each([
    ['below the first tier', [{ productId: P1, quantity: 1 }], []],
    ['exactly on the first tier', [{ productId: P1, quantity: 2 }], [gift(2, 1, 1)]],
    ['between tiers', [{ productId: P1, quantity: 3 }], [gift(2, 1, 1)]],
    ['exactly on a middle tier', [{ productId: P1, quantity: 4 }], [gift(4, 2, 2)]],
    ['above the last tier', [{ productId: P1, quantity: 50 }], [gift(6, 3, 3)]],
    ['an empty sale', [], []],
  ])('%s', (_name, items, expected) => {
    expect(evaluatePromotions([promotion], items)).toEqual(expected);
  });

  it('gives one entitlement per sale, not per unit', () => {
    const single = {
      id: 'p1',
      productId: null,
      tiers: [{ id: 't', minQuantity: 1, stockItemId: GIFT(1), giftQuantity: 1 }],
    };
    expect(evaluatePromotions([single], [{ productId: P1, quantity: 10 }])).toHaveLength(1);
    expect(evaluatePromotions([single], [{ productId: P1, quantity: 10 }])[0].quantity).toBe(1);
  });

  it('adds up several lines of the same product', () => {
    const items = [
      { productId: P1, quantity: 1 },
      { productId: P1, quantity: 1 },
      { productId: P2, quantity: 1 },
    ];
    expect(evaluatePromotions([tiered('p1', P1, [2, 3])], items)).toEqual([
      { promotionId: 'p1', tierId: 'p1-t2', stockItemId: GIFT(1), quantity: 1 },
    ]);
  });

  it('counts only the promotion product, or every product when unscoped', () => {
    const items = [
      { productId: P1, quantity: 1 },
      { productId: P2, quantity: 2 },
    ];
    expect(evaluatePromotions([tiered('p1', P1, [2, 3])], items)).toEqual([]);
    expect(evaluatePromotions([tiered('p1', P2, [2, 3])], items)).toHaveLength(1);
    expect(evaluatePromotions([tiered('p1', null, [3, 4])], items)).toHaveLength(1);
  });

  it('evaluates promotions on different products independently, ordered by promotion id', () => {
    const items = [
      { productId: P1, quantity: 3 },
      { productId: P2, quantity: 1 },
    ];
    const promotions = [tiered(B, P2, [1, 2]), tiered(A, P1, [1, 3])];
    const result = evaluatePromotions(promotions, items);
    expect(result.map(({ promotionId, tierId }) => [promotionId, tierId])).toEqual([
      [A, A + '-t3'],
      [B, B + '-t1'],
    ]);
    expect(evaluatePromotions([...promotions].reverse(), items)).toEqual(result);
    expect(promotions[0].id).toBe(B);
  });

  it('is deterministic and does not mutate its input', () => {
    const input = [promotion];
    const snapshot = JSON.stringify(input);
    const items = [{ productId: P1, quantity: 5 }];
    expect(evaluatePromotions(input, items)).toEqual(evaluatePromotions(input, items));
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('refuses invalid quantities instead of guessing', () => {
    for (const quantity of [0, -1, 1.5, '2']) {
      expect(() => evaluatePromotions([promotion], [{ productId: P1, quantity }])).toThrow(
        RangeError,
      );
    }
  });
});

describe('promotion payload', () => {
  it('defaults the scope and the per-customer limit to null', () => {
    const parsed = promotionSchema.parse({
      type: 'gift_with_purchase',
      name: 'Free mug',
      tiers: [{ minQuantity: 1, stockItemId: GIFT(1), giftQuantity: 1 }],
    });
    expect(parsed).toMatchObject({ productId: null, maxPerCustomer: null });
    expect(promotionSchema.safeParse({ ...parsed, maxPerCustomer: 101 }).success).toBe(false);
  });
});

describe('lifecycle table and edit policy', () => {
  it('lists the actions available from each status', () => {
    expect(actionsFrom('draft')).toEqual(['plan', 'cancel']);
    expect(actionsFrom('active')).toEqual(['suspend', 'complete', 'cancel']);
    expect(actionsFrom('closed')).toEqual([]);
    expect(Object.keys(TRANSITIONS)).toHaveLength(8);
  });

  it('knows when a reason is required', () => {
    expect(reasonRequired('suspend', false)).toBe(true);
    expect(reasonRequired('cancel', false)).toBe(true);
    expect(reasonRequired('complete', true)).toBe(true);
    expect(reasonRequired('complete', false)).toBe(false);
    expect(reasonRequired('plan', true)).toBe(false);
  });

  it.each([
    ['draft', 'details', true],
    ['active', 'details', true],
    ['closed', 'details', false],
    ['planning', 'startDate', true],
    ['active', 'startDate', false],
    ['assigned', 'approver', true],
    ['suspended', 'approver', false],
    ['active', 'coverage', true],
    ['completed', 'coverage', false],
    ['active', 'ruleSet', true],
    ['cancelled', 'ruleSet', false],
    ['completed', 'documents', true],
    ['closed', 'documents', false],
    ['cancelled', 'documents', false],
  ])('%s · %s → %s', (status, area, allowed) => {
    expect(canEdit({ status }, area).allowed).toBe(allowed);
  });

  it('lets live campaigns extend the end date only, and add products only', () => {
    const campaign = { status: 'active', endDate: '2027-03-12' };
    const today = '2027-03-01';
    expect(canEdit(campaign, 'endDate', { endDate: '2027-04-01', today }).allowed).toBe(true);
    expect(canEdit(campaign, 'endDate', { endDate: '2027-03-12', today }).allowed).toBe(true);
    expect(canEdit(campaign, 'endDate', { endDate: '2027-03-10', today }).allowed).toBe(false);
    expect(
      canEdit(campaign, 'endDate', { endDate: '2027-04-01', today: '2027-05-01' }).allowed,
    ).toBe(false);
    expect(
      canEdit({ status: 'completed' }, 'endDate', { endDate: '2030-01-01', today }).allowed,
    ).toBe(false);
    expect(canEdit(campaign, 'products', { removing: false }).allowed).toBe(true);
    expect(canEdit(campaign, 'products', { removing: true })).toMatchObject({
      allowed: false,
      code: 'PRODUCT_REMOVAL_LOCKED',
    });
    expect(canEdit({ status: 'draft' }, 'products', { removing: true }).allowed).toBe(true);
  });
});
