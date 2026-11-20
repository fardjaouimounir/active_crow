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

export const inventoryReadService = Object.freeze({ hasOpenHoldings });
