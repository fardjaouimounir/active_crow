// Read-only answers about clients for other modules (the organization users service checks that a
// portal account belongs to an active client; campaigns check their client and products). Kept
// apart from catalog.service, which itself calls the organization module, so the modules never
// import each other in a cycle.
import { findClient } from './catalog.repository.js';

/** Whether `clientId` is a non-deleted client of the scope's agency. */
async function isActiveClient(db, scope, clientId) {
  return Boolean(await findClient(db, scope, clientId));
}

/** The ids among `productIds` that are non-deleted products of the client. */
async function activeProductIds(db, scope, clientId, productIds) {
  if (!productIds.length) return [];
  const rows = await db.product.findMany({
    where: { agencyId: scope.agencyId, clientId, id: { in: productIds }, deletedAt: null },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** The ids among `ids` that are non-deleted stock items of the client with the given kind. */
async function activeStockItemIds(db, scope, clientId, ids, kind) {
  if (!ids.length) return [];
  const rows = await db.stockItem.findMany({
    where: { agencyId: scope.agencyId, clientId, kind, id: { in: ids }, deletedAt: null },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export const clientReadService = Object.freeze({
  isActiveClient,
  activeProductIds,
  activeStockItemIds,
});
