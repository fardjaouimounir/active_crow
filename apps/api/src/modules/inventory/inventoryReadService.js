/** Returns whether the holder has a positive balance and which open campaigns it belongs to. */
async function hasOpenHoldings(tx, userId) {
  const locations = await tx.stockLocation.findMany({
    where: {
      userId,
      kind: 'holder',
      campaign: { status: { not: 'closed' } },
      balances: { some: { quantity: { gt: 0 } } },
    },
    select: { campaign: { select: { code: true } } },
    orderBy: { campaign: { code: 'asc' } },
  });
  return {
    hasHoldings: locations.length > 0,
    campaigns: [...new Set(locations.map(({ campaign }) => campaign.code))],
  };
}

/** Locations that physically hold stock; external, customers and losses are bookkeeping counterparts. */
const PHYSICAL_LOCATIONS = ['warehouse', 'holder', 'in_transit'];
/** Movements still waiting for someone's decision. */
const OPEN_MOVEMENT_STATUSES = ['pending', 'disputed', 'pending_approval'];

/** Non-zero balances of the campaign in physical locations. */
function countPhysicalBalances(db, campaignId) {
  return db.stockBalance.count({
    where: {
      locationKind: { in: PHYSICAL_LOCATIONS },
      quantity: { not: 0 },
      location: { campaignId },
    },
  });
}

/** Movements of the campaign still pending, disputed or waiting for approval. */
function countOpenMovements(db, campaignId) {
  return db.stockMovement.count({
    where: { campaignId, status: { in: OPEN_MOVEMENT_STATUSES } },
  });
}

/**
 * What prevents closing the campaign (BR-15), as readiness blockers; empty when it can be closed.
 * @returns {Promise<Array<{ code: string, details: { count: number } }>>}
 */
async function closingBlockers(db, campaignId) {
  const blockers = [];
  const balances = await countPhysicalBalances(db, campaignId);
  if (balances > 0)
    blockers.push({ code: 'PHYSICAL_STOCK_REMAINING', details: { count: balances } });
  const movements = await countOpenMovements(db, campaignId);
  if (movements > 0) blockers.push({ code: 'OPEN_STOCK_MOVEMENTS', details: { count: movements } });
  return blockers;
}

export const inventoryReadService = Object.freeze({
  hasOpenHoldings,
  countPhysicalBalances,
  countOpenMovements,
  closingBlockers,
});
