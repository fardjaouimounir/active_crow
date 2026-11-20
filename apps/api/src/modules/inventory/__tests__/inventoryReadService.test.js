import { expect, it } from 'vitest';
import {
  createAgency,
  createCampaign,
  createClient,
  createStockItem,
  createUser,
} from '../../../db/__tests__/factories.js';
import { withTransaction } from '../../../db/transaction.js';
import { inventoryReadService } from '../inventoryReadService.js';

it('BR-04 reads only positive balances in holder locations of non-closed campaigns', async () => {
  const { id: agencyId } = await createAgency();
  const client = await createClient(agencyId);
  const holder = await createUser(agencyId);
  const other = await createUser(agencyId);
  const stockItem = await createStockItem(agencyId, client.id);
  const open = await createCampaign(agencyId, client.id);
  const zero = await createCampaign(agencyId, client.id);
  const closed = await createCampaign(agencyId, client.id, { status: 'closed' });

  await withTransaction(async (tx) => {
    async function balance(campaignId, userId, quantity) {
      const location = await tx.stockLocation.create({
        data: { agencyId, campaignId, kind: 'holder', userId },
      });
      await tx.stockBalance.create({
        data: {
          agencyId,
          locationId: location.id,
          locationKind: 'holder',
          stockItemId: stockItem.id,
          quantity,
        },
      });
    }
    await balance(open.id, holder.id, 3);
    await balance(zero.id, holder.id, 0);
    await balance(closed.id, holder.id, 2);
    await expect(inventoryReadService.hasOpenHoldings(tx, holder.id)).resolves.toEqual({
      hasHoldings: true,
      campaigns: [open.code],
    });
    await expect(inventoryReadService.hasOpenHoldings(tx, other.id)).resolves.toEqual({
      hasHoldings: false,
      campaigns: [],
    });
  });
});
