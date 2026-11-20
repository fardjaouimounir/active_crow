// Checks that need the database (references to products and stock items) on top of the shared Zod
// schemas. They return problem lists so the editor can show every one; mutating endpoints throw the
// first, approval reports them all. Every problem carries `path` — the request field to highlight.
import { ERROR_CODES, PROMOTION_LIMITS, validateRuleConfig } from '@fieldflow/shared';
import { AppError } from '../../core/errors/index.js';
import { clientReadService } from '../catalog/clientReadService.js';
import * as campaignsRepository from './campaigns.repository.js';

/**
 * @typedef {{ code: string, path: string, message: string, reason?: string }} Problem
 */

const promotionProblem = (reason, path, message) => ({
  code: ERROR_CODES.PROMOTION_INVALID,
  reason,
  path,
  message,
});

/** Structure of one promotion: tier counts, ordering and the gift quantity range. */
function structureProblems(promotion, base) {
  const problems = [];
  const { tiers, type } = promotion;
  if (type === 'gift_with_purchase') {
    if (tiers.length !== 1) {
      problems.push(
        promotionProblem('GWP_REQUIRES_ONE_TIER', base + '.tiers', 'Use exactly one tier'),
      );
    } else if (tiers[0].minQuantity !== 1) {
      problems.push(
        promotionProblem(
          'GWP_MIN_QUANTITY_MUST_BE_1',
          base + '.tiers.0.minQuantity',
          'A gift with purchase starts at 1 unit',
        ),
      );
    }
  } else if (tiers.length < PROMOTION_LIMITS.minTiers || tiers.length > PROMOTION_LIMITS.maxTiers) {
    problems.push(
      promotionProblem(
        'TIERED_REQUIRES_2_TO_6_TIERS',
        base + '.tiers',
        'Use between 2 and 6 tiers',
      ),
    );
  }
  tiers.forEach((tier, index) => {
    if (index > 0 && tier.minQuantity <= tiers[index - 1].minQuantity) {
      problems.push(
        promotionProblem(
          'TIERS_NOT_STRICTLY_INCREASING',
          `${base}.tiers.${index}.minQuantity`,
          'Each tier must need more units than the previous one',
        ),
      );
    }
    if (tier.giftQuantity < 1 || tier.giftQuantity > PROMOTION_LIMITS.maxGiftQuantity) {
      problems.push(
        promotionProblem(
          'GIFT_QUANTITY_OUT_OF_RANGE',
          `${base}.tiers.${index}.giftQuantity`,
          'The gift quantity must be between 1 and 100',
        ),
      );
    }
  });
  return problems;
}

/**
 * Every problem of a promotions payload for the campaign: structure, gifts of the client's own
 * (kind `gift`, not deleted), product scope within the campaign's products, and scope overlap.
 * @param {object} tx
 * @param {{ agencyId: string }} scope
 * @param {{ id: string, clientId: string }} campaign
 * @param {Array<{ type: string, productId: string | null, tiers: Array<{ minQuantity: number, stockItemId: string, giftQuantity: number }> }>} promotions
 * @param {string} [prefix] path prefix of the array in the request body
 * @returns {Promise<Problem[]>}
 */
export async function promotionProblems(
  tx,
  scope,
  campaign,
  promotions,
  prefix = 'body.promotions',
) {
  const problems = promotions.flatMap((promotion, index) =>
    structureProblems(promotion, `${prefix}.${index}`),
  );

  const giftIds = [...new Set(promotions.flatMap((p) => p.tiers.map((t) => t.stockItemId)))];
  const gifts = await clientReadService.activeStockItemIds(
    tx,
    scope,
    campaign.clientId,
    giftIds,
    'gift',
  );
  const campaignProducts = await campaignsRepository.linkedProductIds(tx, campaign.id);

  promotions.forEach((promotion, index) => {
    promotion.tiers.forEach((tier, tierIndex) => {
      if (!gifts.includes(tier.stockItemId)) {
        problems.push({
          code: ERROR_CODES.GIFT_NOT_OF_CLIENT,
          path: `${prefix}.${index}.tiers.${tierIndex}.stockItemId`,
          message: "The gift must be an active gift item of the campaign's client",
        });
      }
    });
    if (promotion.productId !== null && !campaignProducts.includes(promotion.productId)) {
      problems.push({
        code: ERROR_CODES.PRODUCT_NOT_IN_CAMPAIGN,
        path: `${prefix}.${index}.productId`,
        message: 'The product is not one of the campaign products',
      });
    }
  });

  const seen = new Set();
  const hasAllProducts = promotions.some((promotion) => promotion.productId === null);
  promotions.forEach((promotion, index) => {
    const overlaps =
      promotion.productId === null
        ? promotions.length > 1
        : seen.has(promotion.productId) || hasAllProducts;
    if (overlaps) {
      problems.push({
        code: ERROR_CODES.PROMOTION_SCOPE_OVERLAP,
        path: `${prefix}.${index}.productId`,
        message:
          'A product can be in only one promotion, and an all-products promotion must be alone',
      });
    }
    if (promotion.productId !== null) seen.add(promotion.productId);
  });
  return problems;
}

/** Reference checks of one rule config (the shape is already valid). @returns {Promise<Array<{ path: string, message: string }>>} */
export async function ruleReferenceIssues(tx, scope, campaign, type, config) {
  const issues = [];
  if (type === 'sales_target') {
    const products = await campaignsRepository.linkedProductIds(tx, campaign.id);
    config.perProduct.forEach((item, index) => {
      if (!products.includes(item.productId)) {
        issues.push({
          path: `perProduct.${index}.productId`,
          message: 'Not a product of the campaign',
        });
      }
    });
  }
  if (type === 'sampling_target') {
    const samples = await clientReadService.activeStockItemIds(
      tx,
      scope,
      campaign.clientId,
      [config.stockItemId],
      'sample',
    );
    if (!samples.length) {
      issues.push({ path: 'stockItemId', message: "Not a sample item of the campaign's client" });
    }
  }
  return issues;
}

/** Shape plus references of one stored rule, for approval. @returns {Promise<Array<{ path: string, message: string }>>} */
export async function ruleIssues(tx, scope, campaign, type, config) {
  const shape = validateRuleConfig(type, config);
  if (!shape.success) return shape.issues;
  return ruleReferenceIssues(tx, scope, campaign, type, shape.data);
}

/** A stored promotion (serialized with tiers) back in the shape the editor sends. */
export function promotionsToPayload(promotions) {
  return promotions.map((promotion) => ({
    type: promotion.type,
    name: promotion.name,
    maxPerCustomer: promotion.maxPerCustomer,
    productId: promotion.productId,
    tiers: promotion.tiers.map(({ minQuantity, stockItemId, giftQuantity }) => ({
      minQuantity,
      stockItemId,
      giftQuantity,
    })),
  }));
}

/** The 422 for one problem, with `details.path` (and `details.reason` for PROMOTION_INVALID). */
export function problemToError({ code, path, message, reason }) {
  return new AppError({
    status: 422,
    code,
    message,
    details: { path, ...(reason ? { reason } : {}) },
  });
}
