import { z } from 'zod';
import { promotionTypeSchema } from '../enums.js';

export const PROMOTION_LIMITS = Object.freeze({
  minTiers: 2,
  maxTiers: 6,
  maxGiftQuantity: 100,
  maxPerCustomer: 100,
});

const tier = z.strictObject({
  minQuantity: z.int().min(1).max(100000),
  stockItemId: z.uuid(),
  // The 1–100 range is checked by the API (PROMOTION_INVALID, with the offending path).
  giftQuantity: z.int(),
});

/**
 * One promotion as the editor sends it. The product scope belongs to the promotion (all its tiers
 * share it); `productId: null` means every campaign product. Structure rules (tier counts, ordering,
 * scope overlap) are checked by the API service.
 */
export const promotionSchema = z.strictObject({
  type: promotionTypeSchema,
  name: z.string().trim().min(1).max(120),
  maxPerCustomer: z.int().min(1).max(PROMOTION_LIMITS.maxPerCustomer).nullable().default(null),
  productId: z.uuid().nullable().default(null),
  tiers: z.array(tier).max(20),
});

export const promotionsPayloadSchema = z.strictObject({
  promotions: z.array(promotionSchema).max(20),
});
