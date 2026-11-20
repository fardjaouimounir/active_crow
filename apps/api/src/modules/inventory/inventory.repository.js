// Queries of the inventory module. Reads take a `scope` (campaignWhere) and a set of holder users the
// actor may see; every query carries the agency.
import { campaignWhere, scoped } from '../../core/authz/index.js';

const person = { select: { id: true, fullName: true, role: true } };
const place = { select: { id: true, kind: true, userId: true, user: person } };

export const movementInclude = {
  fromLocation: place,
  toLocation: place,
  createdBy: person,
  confirmedBy: person,
  approvedBy: person,
  lines: {
    orderBy: { stockItem: { sku: 'asc' } },
    select: {
      id: true,
      stockItemId: true,
      quantity: true,
      quantityReceived: true,
      stockItem: { select: { sku: true, name: true, unitLabel: true } },
    },
  },
  resolvedBy: { select: { id: true } },
};

const placeOf = (location) => ({
  id: location.id,
  kind: location.kind,
  userId: location.userId,
  fullName: location.user?.fullName ?? null,
  role: location.user?.role ?? null,
});

/** The API shape of a movement (list rows and detail share it). */
export function serializeMovement(row) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    type: row.type,
    status: row.status,
    reference: row.reference,
    note: row.note,
    proofFileId: row.proofFileId,
    resolvesMovementId: row.resolvesMovementId,
    giftEntitlementId: row.giftEntitlementId,
    resolved: row.resolvedBy.length > 0,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    approvedAt: row.approvedAt,
    from: placeOf(row.fromLocation),
    to: placeOf(row.toLocation),
    createdBy: row.createdBy,
    confirmedBy: row.confirmedBy,
    approvedBy: row.approvedBy,
    lines: row.lines.map((line) => ({
      stockItemId: line.stockItemId,
      sku: line.stockItem.sku,
      name: line.stockItem.name,
      quantity: line.quantity,
      quantityReceived: line.quantityReceived,
    })),
  };
}

export const findCampaign = (db, scope, id) =>
  db.campaign.findFirst({
    where: scoped(campaignWhere(scope), { id }),
    select: { id: true, agencyId: true, clientId: true, status: true, code: true, name: true },
  });

/** A movement's campaign, whatever the actor's campaign scope (visibility is checked separately). */
export const findMovementCampaign = (db, agencyId, movementId) =>
  db.stockMovement.findFirst({
    where: { id: movementId, agencyId },
    select: {
      campaign: {
        select: { id: true, agencyId: true, clientId: true, status: true, code: true, name: true },
      },
    },
  });

/** Takes the row lock that serialises confirm / cancel / decisions on one movement. */
export async function lockMovement(tx, agencyId, movementId) {
  await tx.$queryRaw`
    SELECT id FROM stock_movements WHERE id = ${movementId}::uuid AND agency_id = ${agencyId}::uuid FOR UPDATE`;
}

const endpoints = (userIds, warehouseToo) => (field) => [
  { [field]: { userId: { in: userIds } } },
  ...(warehouseToo ? [{ [field]: { kind: 'warehouse' } }] : []),
];

/**
 * Filter on movements the actor may see: one of the two ends (or the movement a resolution settles)
 * is a visible holder, or — for a regional manager — the campaign warehouse. Agency-wide actors
 * (`holderIds` null) see all movements of their agency.
 * @param {Set<string> | null} holderIds
 */
export function movementAccess(scope, holderIds, role) {
  if (holderIds === null) return { agencyId: scope.agencyId };
  const ends = endpoints([...holderIds], role === 'regional_manager');
  const own = [...ends('fromLocation'), ...ends('toLocation')];
  const party = [
    { fromLocation: { userId: scope.userId } },
    { toLocation: { userId: scope.userId } },
  ];
  const settled = [...ends('fromLocation'), ...ends('toLocation')];
  return {
    agencyId: scope.agencyId,
    OR: [
      ...party,
      {
        campaign: campaignWhere(scope),
        OR: [...own, { resolvesMovement: { OR: settled } }],
      },
    ],
  };
}

export const findMovement = (db, where) =>
  db.stockMovement.findFirst({ where, include: movementInclude });

export function createMovement(tx, campaign, actor, data) {
  const { lines, ...fields } = data;
  return tx.stockMovement.create({
    data: {
      agencyId: campaign.agencyId,
      campaignId: campaign.id,
      createdById: actor.id,
      ...fields,
      lines: {
        create: lines.map(({ stockItemId, quantity }) => ({
          agencyId: campaign.agencyId,
          stockItemId,
          quantity,
        })),
      },
    },
    include: { lines: true },
  });
}

/** Stock items of the campaign's client among `ids` (deleted items excluded when `activeOnly`). */
export const clientStockItems = (db, campaign, ids, activeOnly) =>
  db.stockItem.findMany({
    where: {
      id: { in: ids },
      agencyId: campaign.agencyId,
      clientId: campaign.clientId,
      ...(activeOnly ? { deletedAt: null } : {}),
    },
    select: { id: true },
  });
