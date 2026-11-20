// The posting engine of the double-entry stock ledger (BR-40, BR-41). It writes balanced ledger
// entries and updates `stock_balances` in the caller's transaction, and nothing else: whether a
// movement is allowed is decided by the services. Internal module, no routes.
import { ERROR_CODES } from '@fieldflow/shared';
import { AppError } from '../../core/errors/index.js';

/** Locations that may go negative: the outside world, customers and written-off losses (BR-41). */
const BOOKKEEPING_KINDS = new Set(['external', 'customers', 'losses']);

export class InsufficientStockError extends AppError {
  /** @param {{ location: object, stockItemId: string, available: number, requested: number }} details */
  constructor(details) {
    super({
      status: 422,
      code: ERROR_CODES.INSUFFICIENT_STOCK,
      message: 'Not enough stock at this location',
      details,
    });
  }
}

/**
 * The location of a campaign, created on first use. Fixed locations have no `userId`; a holder
 * location has one. Safe under concurrency (unique index, `ON CONFLICT DO NOTHING`).
 * @param {object} tx
 * @param {{ agencyId: string, campaignId: string, kind: string, userId?: string | null }} where
 */
export async function getOrCreateLocation(tx, { agencyId, campaignId, kind, userId = null }) {
  const find = () => tx.stockLocation.findFirst({ where: { agencyId, campaignId, kind, userId } });
  const existing = await find();
  if (existing) return existing;
  await tx.$executeRaw`
    INSERT INTO stock_locations (agency_id, campaign_id, kind, user_id)
    VALUES (${agencyId}::uuid, ${campaignId}::uuid, ${kind}::stock_location_kind, ${userId}::uuid)
    ON CONFLICT DO NOTHING`;
  return find();
}

export const getOrCreateHolderLocation = (tx, { agencyId, campaignId, userId }) =>
  getOrCreateLocation(tx, { agencyId, campaignId, kind: 'holder', userId });

const pairKey = (locationId, stockItemId) => `${locationId}|${stockItemId}`;

function checkLegs(legs) {
  if (!legs.length) throw new Error('A movement needs at least one line');
  for (const leg of legs) {
    if (!Number.isInteger(leg.quantity) || leg.quantity < 1)
      throw new Error('Ledger quantities are integers greater than zero');
    if (leg.fromLocationId === leg.toLocationId)
      throw new Error('A ledger leg needs two different locations');
  }
}

/** Net change per (location, item), keys sorted so that every transaction locks in the same order. */
function netChanges(legs) {
  const net = new Map();
  const add = (locationId, stockItemId, delta) => {
    const key = pairKey(locationId, stockItemId);
    net.set(key, { locationId, stockItemId, delta: (net.get(key)?.delta ?? 0) + delta });
  };
  for (const leg of legs) {
    add(leg.fromLocationId, leg.stockItemId, -leg.quantity);
    add(leg.toLocationId, leg.stockItemId, leg.quantity);
  }
  return [...net.values()].sort(
    (a, b) => compare(a.locationId, b.locationId) || compare(a.stockItemId, b.stockItemId),
  );
}
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Posts one or more legs of a movement. Each leg moves `quantity` of one item from one location to
 * another, as a pair of ledger entries (−q, +q) on the leg's movement line. The affected balance
 * rows are created if missing, locked (`FOR UPDATE`, ordered by location then item) and checked
 * before anything is written, so a refused posting leaves no trace and cannot deadlock with another.
 *
 * @param {object} tx
 * @param {{ id: string, agencyId: string, campaignId: string }} movement
 * @param {Array<{ lineId: string, stockItemId: string, fromLocationId: string, toLocationId: string, quantity: number }>} legs
 * @throws {InsufficientStockError} a non-bookkeeping location would go below zero
 */
export async function post(tx, movement, legs) {
  checkLegs(legs);
  const changes = netChanges(legs);
  const locationIds = [...new Set(changes.map((change) => change.locationId))];
  const locations = await tx.stockLocation.findMany({
    where: {
      id: { in: locationIds },
      agencyId: movement.agencyId,
      campaignId: movement.campaignId,
    },
    select: { id: true, kind: true, userId: true },
  });
  if (locations.length !== locationIds.length)
    throw new Error('A ledger leg refers to a location outside the campaign');
  const byId = new Map(locations.map((location) => [location.id, location]));

  const locationColumn = changes.map((change) => change.locationId);
  const itemColumn = changes.map((change) => change.stockItemId);
  const kindColumn = changes.map((change) => byId.get(change.locationId).kind);
  await tx.$executeRaw`
    INSERT INTO stock_balances (location_id, stock_item_id, agency_id, location_kind, quantity)
    SELECT t.location_id, t.stock_item_id, ${movement.agencyId}::uuid, t.kind::stock_location_kind, 0
    FROM unnest(${locationColumn}::uuid[], ${itemColumn}::uuid[], ${kindColumn}::text[])
      AS t(location_id, stock_item_id, kind)
    ORDER BY t.location_id, t.stock_item_id
    ON CONFLICT DO NOTHING`;
  const locked = await tx.$queryRaw`
    SELECT b.location_id, b.stock_item_id, b.quantity
    FROM stock_balances b
    WHERE (b.location_id, b.stock_item_id) IN (
      SELECT t.location_id, t.stock_item_id
      FROM unnest(${locationColumn}::uuid[], ${itemColumn}::uuid[]) AS t(location_id, stock_item_id))
    ORDER BY b.location_id, b.stock_item_id
    FOR UPDATE`;
  const available = new Map(
    locked.map((row) => [pairKey(row.location_id, row.stock_item_id), row.quantity]),
  );

  for (const { locationId, stockItemId, delta } of changes) {
    const location = byId.get(locationId);
    const balance = available.get(pairKey(locationId, stockItemId)) ?? 0;
    if (!BOOKKEEPING_KINDS.has(location.kind) && balance + delta < 0) {
      throw new InsufficientStockError({
        location: { id: location.id, kind: location.kind, userId: location.userId },
        stockItemId,
        available: balance,
        requested: -delta,
      });
    }
  }

  const entry = (leg, locationId, quantityDelta) => ({
    agencyId: movement.agencyId,
    campaignId: movement.campaignId,
    movementId: movement.id,
    movementLineId: leg.lineId,
    stockItemId: leg.stockItemId,
    locationId,
    quantityDelta,
  });
  await tx.stockLedgerEntry.createMany({
    data: legs.flatMap((leg) => [
      entry(leg, leg.fromLocationId, -leg.quantity),
      entry(leg, leg.toLocationId, leg.quantity),
    ]),
  });
  await tx.$executeRaw`
    UPDATE stock_balances b
    SET quantity = b.quantity + d.delta, updated_at = now()
    FROM unnest(${locationColumn}::uuid[], ${itemColumn}::uuid[], ${changes.map((change) => change.delta)}::int[])
      AS d(location_id, stock_item_id, delta)
    WHERE b.location_id = d.location_id AND b.stock_item_id = d.stock_item_id`;
}
