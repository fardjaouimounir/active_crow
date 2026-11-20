// Gift entitlement evaluation (BR-31): the single pure function the sales module (API) and the
// promotion preview (web) both use. No I/O, no dates, no randomness.

/**
 * @typedef {{ id: string, minQuantity: number, stockItemId: string, giftQuantity: number }} EvaluatedTier
 * @typedef {{ id: string, productId: string | null, tiers: EvaluatedTier[] }} EvaluatedPromotion
 * @typedef {{ promotionId: string, tierId: string, stockItemId: string, quantity: number }} Entitlement
 */

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * For each promotion: the qualifying quantity is the sum of the sale lines in its scope (one product,
 * or every product when `productId` is null); the tier with the highest `minQuantity` not above it
 * wins, and yields ONE entitlement of that tier's `giftQuantity` — never multiplied by the units
 * bought. No tier reached means nothing. `maxPerCustomer` is NOT applied here: it needs the
 * customer's history, which the sales module owns.
 *
 * @param {EvaluatedPromotion[]} promotions
 * @param {Array<{ productId: string, quantity: number }>} saleItems
 * @returns {Entitlement[]} ordered by promotion id
 */
export function evaluatePromotions(promotions, saleItems) {
  for (const item of saleItems) {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new RangeError('Sale item quantities must be positive integers');
    }
  }
  const entitlements = [];
  for (const promotion of [...promotions].sort(byId)) {
    const qualifying = saleItems
      .filter((item) => promotion.productId === null || item.productId === promotion.productId)
      .reduce((sum, item) => sum + item.quantity, 0);
    const reached = promotion.tiers
      .filter((tier) => tier.minQuantity <= qualifying)
      .sort((a, b) => b.minQuantity - a.minQuantity || byId(a, b));
    if (reached.length === 0) continue;
    const [tier] = reached;
    entitlements.push({
      promotionId: promotion.id,
      tierId: tier.id,
      stockItemId: tier.stockItemId,
      quantity: tier.giftQuantity,
    });
  }
  return entitlements;
}
