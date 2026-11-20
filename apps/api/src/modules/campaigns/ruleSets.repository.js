// Rule sets (FR-033/034): versions of a campaign's rules and promotions. Every function filters by
// the agency of the scope; the service holds the campaign row lock for mutations.

const person = { select: { id: true, fullName: true } };
const summaryFields = {
  id: true,
  version: true,
  status: true,
  effectiveFrom: true,
  approvedAt: true,
  source: true,
  createdAt: true,
  approvedBy: person,
};
const detailFields = {
  ...summaryFields,
  rules: { select: { ruleType: true, config: true } },
  promotions: {
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      type: true,
      name: true,
      maxPerCustomer: true,
      tiers: {
        orderBy: { minQuantity: 'asc' },
        select: {
          id: true,
          productId: true,
          minQuantity: true,
          stockItemId: true,
          giftQuantity: true,
        },
      },
    },
  },
};

/** Rules as a `{ ruleType: config }` map; each promotion with the product scope shared by its tiers. */
function serialize(row) {
  if (!row) return row;
  const { rules, promotions, ...ruleSet } = row;
  return {
    ...ruleSet,
    rules: Object.fromEntries(rules.map((rule) => [rule.ruleType, rule.config])),
    promotions: promotions.map(({ tiers, ...promotion }) => ({
      ...promotion,
      productId: tiers[0]?.productId ?? null,
      tiers: tiers.map(({ productId: _productId, ...tier }) => tier),
    })),
  };
}

const owned = (scope, campaignId) => ({ agencyId: scope.agencyId, campaignId });

export function listRuleSets(db, scope, campaignId) {
  return db.ruleSet.findMany({
    where: owned(scope, campaignId),
    orderBy: { version: 'desc' },
    select: summaryFields,
  });
}

export async function findRuleSet(db, scope, campaignId, id) {
  return serialize(
    await db.ruleSet.findFirst({
      where: { ...owned(scope, campaignId), id },
      select: detailFields,
    }),
  );
}

/** The version in force at `at`: the latest approved or superseded one that took effect by then. */
export async function findEffective(db, scope, campaignId, at) {
  return serialize(
    await db.ruleSet.findFirst({
      where: {
        ...owned(scope, campaignId),
        status: { in: ['approved', 'superseded'] },
        effectiveFrom: { lte: at },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      select: detailFields,
    }),
  );
}

export function currentApproved(tx, scope, campaignId) {
  return tx.ruleSet.findFirst({
    where: { ...owned(scope, campaignId), status: 'approved' },
    orderBy: { version: 'desc' },
    select: { id: true, version: true },
  });
}

export async function hasApproved(db, scope, campaignId) {
  const row = await db.ruleSet.findFirst({
    where: { ...owned(scope, campaignId), status: 'approved' },
    select: { id: true },
  });
  return Boolean(row);
}

export function findDraft(tx, scope, campaignId) {
  return tx.ruleSet.findFirst({
    where: { ...owned(scope, campaignId), status: 'draft' },
    select: { id: true, version: true },
  });
}

export async function nextVersion(tx, scope, campaignId) {
  const { _max } = await tx.ruleSet.aggregate({
    where: owned(scope, campaignId),
    _max: { version: true },
  });
  return (_max.version ?? 0) + 1;
}

export function createDraft(tx, scope, campaignId, version) {
  return tx.ruleSet.create({
    data: { ...owned(scope, campaignId), version, status: 'draft', source: 'manual' },
    select: { id: true },
  });
}

export function upsertRule(tx, scope, ruleSetId, ruleType, config) {
  return tx.campaignRule.upsert({
    where: { ruleSetId_ruleType: { ruleSetId, ruleType } },
    create: { agencyId: scope.agencyId, ruleSetId, ruleType, config },
    update: { config },
    select: { id: true },
  });
}

export async function deleteRule(tx, ruleSetId, ruleType) {
  const { count } = await tx.campaignRule.deleteMany({ where: { ruleSetId, ruleType } });
  return count;
}

async function insertPromotion(tx, scope, ruleSetId, promotion) {
  const created = await tx.promotion.create({
    data: {
      agencyId: scope.agencyId,
      ruleSetId,
      type: promotion.type,
      name: promotion.name,
      maxPerCustomer: promotion.maxPerCustomer,
    },
    select: { id: true },
  });
  await tx.promotionTier.createMany({
    data: promotion.tiers.map((tier) => ({
      agencyId: scope.agencyId,
      promotionId: created.id,
      productId: promotion.productId,
      minQuantity: tier.minQuantity,
      stockItemId: tier.stockItemId,
      giftQuantity: tier.giftQuantity,
    })),
  });
}

async function deletePromotions(tx, ruleSetId) {
  await tx.promotionTier.deleteMany({ where: { promotion: { ruleSetId } } });
  await tx.promotion.deleteMany({ where: { ruleSetId } });
}

/** Replaces all promotions (and their tiers) of a draft rule set. */
export async function replacePromotions(tx, scope, ruleSetId, promotions) {
  await deletePromotions(tx, ruleSetId);
  for (const promotion of promotions) await insertPromotion(tx, scope, ruleSetId, promotion);
}

/** Copies the rules and promotions (with tiers) of `source` (a serialized rule set) into `targetId`. */
export async function copyContent(tx, scope, source, targetId) {
  for (const [ruleType, config] of Object.entries(source.rules)) {
    await upsertRule(tx, scope, targetId, ruleType, config);
  }
  for (const promotion of source.promotions) await insertPromotion(tx, scope, targetId, promotion);
}

export function supersede(tx, scope, id) {
  return tx.ruleSet.update({
    where: { id, agencyId: scope.agencyId },
    data: { status: 'superseded' },
    select: { id: true },
  });
}

export function approve(tx, scope, id, { approvedById, at }) {
  return tx.ruleSet.update({
    where: { id, agencyId: scope.agencyId },
    data: { status: 'approved', effectiveFrom: at, approvedById, approvedAt: at },
    select: { id: true },
  });
}

export async function deleteRuleSet(tx, scope, id) {
  await deletePromotions(tx, id);
  await tx.campaignRule.deleteMany({ where: { ruleSetId: id } });
  await tx.ruleSet.delete({ where: { id, agencyId: scope.agencyId } });
}
