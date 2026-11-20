// Read models of the stock ledger: balances matrix, movements, reconciliation (FR-081, FR-083),
// valid recipients and "my stock". Everything follows the actor's scope: agency-wide roles see the
// whole campaign, a regional manager the warehouse and their holders, a supervisor themselves and
// their Animateurs, an Animateur only themselves.
import { can, reconciliationCheck } from '@fieldflow/shared';
import { campaignWhere, ScopeService } from '../../core/authz/index.js';
import { NotFoundError } from '../../core/errors/index.js';
import { logger } from '../../config/logger.js';
import { prisma } from '../../db/client.js';
import * as policies from './inventory.policies.js';
import * as repo from './inventory.repository.js';

const KIND_ORDER = ['warehouse', 'in_transit', 'holder', 'customers', 'losses', 'external'];
const ZONE = '+01:00'; // Africa/Algiers has no daylight saving time.

async function context(actor, campaignId) {
  const scope = ScopeService.resolve(actor);
  const campaign = await repo.findCampaign(prisma, scope, campaignId);
  if (!campaign) throw new NotFoundError();
  const holderIds = await policies.holderUserIdsInScope(prisma, actor, campaign.id);
  return { scope, campaign, holderIds };
}

/** Where-clause on locations the actor may see (external is bookkeeping and never shown). */
function locationFilter(actor, holderIds) {
  if (holderIds === null) return { kind: { not: 'external' } };
  const holders = { kind: 'holder', userId: { in: [...holderIds] } };
  return actor.role === 'regional_manager'
    ? { OR: [{ kind: { in: ['warehouse', 'in_transit'] } }, holders] }
    : holders;
}

const nameOf = (location) => location.user?.fullName ?? null;
const byOrder = (a, b) =>
  KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
  (a.fullName ?? '').localeCompare(b.fullName ?? '');

async function visibleLocations(campaign, actor, holderIds) {
  const rows = await prisma.stockLocation.findMany({
    where: {
      agencyId: campaign.agencyId,
      campaignId: campaign.id,
      ...locationFilter(actor, holderIds),
    },
    select: {
      id: true,
      kind: true,
      userId: true,
      user: { select: { fullName: true, role: true } },
    },
  });
  return rows
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      userId: row.userId,
      fullName: nameOf(row),
      role: row.user?.role ?? null,
    }))
    .sort(byOrder);
}

/** FR-081: locations × items, with totals. */
export async function balances(actor, campaignId) {
  const { campaign, holderIds } = await context(actor, campaignId);
  const locations = await visibleLocations(campaign, actor, holderIds);
  const rows = await prisma.stockBalance.findMany({
    where: { locationId: { in: locations.map(({ id }) => id) } },
    select: {
      locationId: true,
      quantity: true,
      stockItem: { select: { id: true, sku: true, name: true, kind: true, unitLabel: true } },
    },
  });
  const items = new Map(rows.map(({ stockItem }) => [stockItem.id, stockItem]));
  const totals = {};
  const matrix = locations.map((location) => {
    const quantities = {};
    for (const row of rows.filter((entry) => entry.locationId === location.id)) {
      quantities[row.stockItem.id] = row.quantity;
      totals[row.stockItem.id] = (totals[row.stockItem.id] ?? 0) + row.quantity;
    }
    return {
      ...location,
      quantities,
      total: Object.values(quantities).reduce((sum, value) => sum + value, 0),
    };
  });
  return {
    items: [...items.values()].sort((a, b) => a.sku.localeCompare(b.sku)),
    locations: matrix,
    totals: {
      quantities: totals,
      total: Object.values(totals).reduce((sum, value) => sum + value, 0),
    },
  };
}

const startOf = (date) => new Date(`${date}T00:00:00.000${ZONE}`);
const endOf = (date) => new Date(`${date}T23:59:59.999${ZONE}`);

/** The campaign's movements, newest first, with the actor's visibility applied. */
export async function movements(actor, campaignId, filters) {
  const { scope, campaign, holderIds } = await context(actor, campaignId);
  const { page, pageSize, type, status, holderUserId, stockItemId, from, to } = filters;
  const where = {
    AND: [
      { campaignId: campaign.id },
      repo.movementAccess(scope, holderIds, actor.role),
      ...(type ? [{ type }] : []),
      ...(status ? [{ status }] : []),
      ...(holderUserId
        ? [
            {
              OR: [
                { fromLocation: { userId: holderUserId } },
                { toLocation: { userId: holderUserId } },
              ],
            },
          ]
        : []),
      ...(stockItemId ? [{ lines: { some: { stockItemId } } }] : []),
      ...(from ? [{ createdAt: { gte: startOf(from) } }] : []),
      ...(to ? [{ createdAt: { lte: endOf(to) } }] : []),
    ],
  };
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      include: repo.movementInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stockMovement.count({ where }),
  ]);
  return { data: rows.map(repo.serializeMovement), meta: { page, pageSize, total } };
}

/** One movement with its lines, ledger entries, resolution and proof file. */
export async function movementDetail(actor, movementId) {
  const scope = ScopeService.resolve(actor);
  const known = await repo.findMovementCampaign(prisma, actor.agencyId, movementId);
  if (!known) throw new NotFoundError();
  const holderIds = await policies.holderUserIdsInScope(prisma, actor, known.campaign.id);
  const row = await repo.findMovement(prisma, {
    AND: [{ id: movementId }, repo.movementAccess(scope, holderIds, actor.role)],
  });
  if (!row) throw new NotFoundError();
  const [entries, resolutions, resolves, decision, proof] = await Promise.all([
    prisma.stockLedgerEntry.findMany({
      where: { movementId, agencyId: actor.agencyId },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        quantityDelta: true,
        createdAt: true,
        stockItemId: true,
        location: { select: { id: true, kind: true, user: { select: { fullName: true } } } },
      },
    }),
    prisma.stockMovement.findMany({
      where: { agencyId: actor.agencyId, resolvesMovementId: movementId },
      include: repo.movementInclude,
    }),
    row.resolvesMovementId
      ? prisma.stockMovement.findFirst({
          where: { id: row.resolvesMovementId, agencyId: actor.agencyId },
          include: repo.movementInclude,
        })
      : null,
    prisma.auditLog.findFirst({
      where: {
        agencyId: actor.agencyId,
        entityType: 'stock_movement',
        entityId: movementId,
        action: { in: ['inventory.adjustment_approved', 'inventory.adjustment_rejected'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { after: true },
    }),
    row.proofFileId
      ? prisma.file.findFirst({
          where: { id: row.proofFileId, agencyId: actor.agencyId },
          select: { id: true, kind: true, mimeType: true },
        })
      : null,
  ]);
  return {
    ...repo.serializeMovement(row),
    reason: row.type === 'adjustment' && !row.resolvesMovementId ? row.reference : null,
    decisionNote: decision?.after?.decisionNote ?? null,
    entries: entries.map((entry) => ({
      id: entry.id.toString(),
      stockItemId: entry.stockItemId,
      locationId: entry.location.id,
      locationKind: entry.location.kind,
      holderName: entry.location.user?.fullName ?? null,
      quantityDelta: entry.quantityDelta,
      createdAt: entry.createdAt,
    })),
    resolutions: resolutions.map(repo.serializeMovement),
    resolves: resolves ? repo.serializeMovement(resolves) : null,
    files: proof ? [proof] : [],
  };
}

/** Valid counterparts for a new transfer (`down`) or return (`up`). */
export async function recipients(actor, campaignId, direction) {
  const { campaign } = await context(actor, campaignId);
  return policies.recipientsFor(prisma, actor, campaign, direction);
}

// ── Reconciliation (FR-083) ─────────────────────────────────────────────────────────────────

const RECONCILIATION_SQL = (campaignId, agencyId) => prisma.$queryRaw`
  SELECT e.location_id, e.stock_item_id,
    COALESCE(SUM(CASE WHEN e.quantity_delta > 0 AND e.location_id = m.to_location_id
                       AND m.type IN ('stock_in', 'transfer', 'return') THEN e.quantity_delta END), 0)::int AS received,
    COALESCE(SUM(CASE WHEN m.type = 'transfer' AND e.location_id = m.from_location_id THEN -e.quantity_delta
                      WHEN m.type = 'adjustment' AND r.type = 'transfer'
                       AND e.location_id = r.from_location_id THEN -e.quantity_delta END), 0)::int AS sent,
    COALESCE(SUM(CASE WHEN m.type = 'return' AND e.location_id = m.from_location_id THEN -e.quantity_delta
                      WHEN m.type = 'adjustment' AND r.type = 'return'
                       AND e.location_id = r.from_location_id THEN -e.quantity_delta END), 0)::int AS returned,
    COALESCE(SUM(CASE WHEN m.type = 'distribution' AND e.location_id = m.from_location_id
                      THEN -e.quantity_delta END), 0)::int AS distributed,
    COALESCE(SUM(CASE WHEN m.type = 'adjustment' AND m.resolves_movement_id IS NULL
                       AND e.location_id = m.from_location_id THEN -e.quantity_delta END), 0)::int AS adjusted
  FROM stock_ledger_entries e
  JOIN stock_movements m ON m.id = e.movement_id
  LEFT JOIN stock_movements r ON r.id = m.resolves_movement_id
  JOIN stock_locations l ON l.id = e.location_id
  WHERE e.campaign_id = ${campaignId}::uuid AND e.agency_id = ${agencyId}::uuid
    AND l.kind IN ('warehouse', 'holder')
  GROUP BY e.location_id, e.stock_item_id`;

const key = (locationId, stockItemId) => `${locationId}|${stockItemId}`;

/** Units still on their way from / to each holder (pending shipments, unresolved shortfalls). */
async function inTransitByHolder(campaign) {
  const open = await prisma.stockMovement.findMany({
    where: {
      campaignId: campaign.id,
      agencyId: campaign.agencyId,
      type: { in: ['transfer', 'return'] },
      status: { in: ['pending', 'disputed'] },
    },
    select: {
      status: true,
      fromLocationId: true,
      toLocationId: true,
      resolvedBy: { select: { id: true } },
      lines: { select: { stockItemId: true, quantity: true, quantityReceived: true } },
    },
  });
  const from = new Map();
  const to = new Map();
  const add = (map, k, value) => map.set(k, (map.get(k) ?? 0) + value);
  for (const movement of open) {
    for (const line of movement.lines) {
      const pending = movement.status === 'pending';
      const unresolved = !pending && movement.resolvedBy.length === 0;
      const outstanding = pending
        ? line.quantity
        : unresolved
          ? line.quantity - (line.quantityReceived ?? 0)
          : 0;
      if (outstanding) add(from, key(movement.fromLocationId, line.stockItemId), outstanding);
      if (pending) add(to, key(movement.toLocationId, line.stockItemId), line.quantity);
    }
  }
  return { from, to };
}

async function campaignTotals(campaign) {
  const [stockIn, returned, fixedBalances] = await Promise.all([
    prisma.$queryRaw`
      SELECT l.stock_item_id AS item, SUM(l.quantity)::int AS quantity
      FROM stock_movement_lines l JOIN stock_movements m ON m.id = l.movement_id
      WHERE m.campaign_id = ${campaign.id}::uuid AND m.type = 'stock_in'
      GROUP BY l.stock_item_id`,
    prisma.$queryRaw`
      SELECT l.stock_item_id AS item, SUM(l.quantity)::int AS quantity
      FROM stock_movement_lines l
      JOIN stock_movements m ON m.id = l.movement_id
      JOIN stock_locations t ON t.id = m.to_location_id
      WHERE m.campaign_id = ${campaign.id}::uuid AND m.type = 'return' AND t.kind = 'external'
      GROUP BY l.stock_item_id`,
    prisma.stockBalance.findMany({
      where: { agencyId: campaign.agencyId, location: { campaignId: campaign.id } },
      select: { stockItemId: true, locationKind: true, quantity: true },
    }),
  ]);
  const byItem = {};
  const slot = (id) =>
    (byItem[id] ??= { stockIn: 0, returnedToClient: 0, customers: 0, losses: 0, physical: 0 });
  stockIn.forEach(({ item, quantity }) => (slot(item).stockIn = quantity));
  returned.forEach(({ item, quantity }) => (slot(item).returnedToClient = quantity));
  let ledgerSum = 0;
  for (const { stockItemId, locationKind, quantity } of fixedBalances) {
    ledgerSum += quantity;
    if (locationKind === 'customers') slot(stockItemId).customers += quantity;
    else if (locationKind === 'losses') slot(stockItemId).losses += quantity;
    else if (locationKind !== 'external') slot(stockItemId).physical += quantity;
  }
  const all = Object.values(byItem).reduce(
    (sum, item) =>
      Object.fromEntries(Object.keys(item).map((name) => [name, sum[name] + item[name]])),
    { stockIn: 0, returnedToClient: 0, customers: 0, losses: 0, physical: 0 },
  );
  return { byItem, all, ledgerSum };
}

/**
 * For every holder and item: received − sent − returned − distributed − adjusted = balance. A row
 * that does not add up is a bug in the ledger code: it is logged as an error and flagged.
 */
export async function reconciliation(actor, campaignId) {
  const { campaign, holderIds } = await context(actor, campaignId);
  const locations = (await visibleLocations(campaign, actor, holderIds)).filter(
    ({ kind }) => kind === 'warehouse' || kind === 'holder',
  );
  const visible = new Map(locations.map((location) => [location.id, location]));
  const [sums, stored, transit] = await Promise.all([
    RECONCILIATION_SQL(campaign.id, campaign.agencyId),
    prisma.stockBalance.findMany({
      where: { locationId: { in: [...visible.keys()] } },
      select: {
        locationId: true,
        stockItemId: true,
        quantity: true,
        stockItem: { select: { sku: true, name: true } },
      },
    }),
    inTransitByHolder(campaign),
  ]);
  const ledger = new Map(sums.map((row) => [key(row.location_id, row.stock_item_id), row]));
  const rows = stored
    .map((balance) => {
      const sum = ledger.get(key(balance.locationId, balance.stockItemId));
      const row = {
        received: sum?.received ?? 0,
        sent: sum?.sent ?? 0,
        returned: sum?.returned ?? 0,
        distributed: sum?.distributed ?? 0,
        adjusted: sum?.adjusted ?? 0,
        balance: balance.quantity,
      };
      return {
        locationId: balance.locationId,
        holder: visible.get(balance.locationId),
        stockItemId: balance.stockItemId,
        sku: balance.stockItem.sku,
        name: balance.stockItem.name,
        ...row,
        inTransitFrom: transit.from.get(key(balance.locationId, balance.stockItemId)) ?? 0,
        inTransitTo: transit.to.get(key(balance.locationId, balance.stockItemId)) ?? 0,
        check: reconciliationCheck(row),
      };
    })
    .sort((a, b) => byOrder(a.holder, b.holder) || a.sku.localeCompare(b.sku));
  for (const row of rows.filter((entry) => !entry.check.ok)) {
    logger.error(
      {
        campaignId: campaign.id,
        locationId: row.locationId,
        stockItemId: row.stockItemId,
        difference: row.check.difference,
      },
      'Stock reconciliation check failed',
    );
  }
  const agencyWide = holderIds === null;
  const totals = agencyWide ? await campaignTotals(campaign) : null;
  if (totals && totals.ledgerSum !== 0)
    logger.error(
      { campaignId: campaign.id, sum: totals.ledgerSum },
      'Stock balances do not sum to zero',
    );
  return {
    rows,
    totals: totals && {
      byItem: totals.byItem,
      all: totals.all,
      balancedToZero: totals.ledgerSum === 0,
    },
    ok: rows.every((row) => row.check.ok) && (!totals || totals.ledgerSum === 0),
  };
}

/** Campaign-wide stock totals for the client portal: no holders, no per-item detail. */
export async function clientStockTotals(campaign) {
  const { all } = await campaignTotals(campaign);
  return {
    stockIn: all.stockIn,
    customers: all.customers,
    losses: all.losses,
    returnedToClient: all.returnedToClient,
    physical: all.physical,
  };
}

// ── My stock ────────────────────────────────────────────────────────────────────────────────

const withCampaign = { campaign: { select: { id: true, code: true, name: true, status: true } } };
const decorate = (row) => ({ ...repo.serializeMovement(row), campaign: row.campaign });

/**
 * The actor's balances across campaigns, shipments waiting for their confirmation, their own
 * pending shipments (cancellable) and, for approvers, adjustments and disputes awaiting a decision.
 */
export async function mine(actor, stockKind) {
  const scope = ScopeService.resolve(actor);
  const agencyWide = policies.isAgencyWide(actor);
  const live = { status: { notIn: ['closed', 'cancelled'] } };
  const ownLocations = {
    agencyId: actor.agencyId,
    campaign: live,
    OR: [{ kind: 'holder', userId: actor.id }, ...(agencyWide ? [{ kind: 'warehouse' }] : [])],
  };
  const [stock, awaiting, outgoing] = await Promise.all([
    prisma.stockBalance.findMany({
      where: {
        quantity: { not: 0 },
        location: ownLocations,
        stockItem: stockKind ? { kind: stockKind } : undefined,
      },
      select: {
        quantity: true,
        stockItem: { select: { id: true, sku: true, name: true, unitLabel: true } },
        location: { select: { id: true, kind: true, ...withCampaign } },
      },
    }),
    prisma.stockMovement.findMany({
      where: {
        agencyId: actor.agencyId,
        status: 'pending',
        type: { in: ['transfer', 'return'] },
        OR: [
          { toLocation: { userId: actor.id } },
          ...(can(actor.role, 'inventory.confirm') && agencyWide
            ? [{ toLocation: { kind: 'warehouse' } }]
            : []),
        ],
      },
      include: { ...repo.movementInclude, ...withCampaign },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
    prisma.stockMovement.findMany({
      where: {
        agencyId: actor.agencyId,
        status: 'pending',
        type: { in: ['transfer', 'return'] },
        createdById: actor.id,
      },
      include: { ...repo.movementInclude, ...withCampaign },
      orderBy: { createdAt: 'asc' },
      take: 100,
    }),
  ]);
  const grouped = new Map();
  for (const row of stock) {
    const entry = grouped.get(row.location.id) ?? {
      locationId: row.location.id,
      kind: row.location.kind,
      campaign: row.location.campaign,
      items: [],
    };
    entry.items.push({
      stockItemId: row.stockItem.id,
      sku: row.stockItem.sku,
      name: row.stockItem.name,
      quantity: row.quantity,
    });
    grouped.set(row.location.id, entry);
  }
  return {
    balances: [...grouped.values()],
    awaitingConfirmation: awaiting.map(decorate),
    outgoing: outgoing.map(decorate),
    approvals: can(actor.role, 'inventory.adjust.approve')
      ? await approvals(actor, scope)
      : { adjustments: [], disputes: [] },
  };
}

async function approvals(actor, scope) {
  const campaignFilter = { status: { notIn: ['closed', 'cancelled'] }, ...campaignWhere(scope) };
  const open = await prisma.stockMovement.findMany({
    where: {
      agencyId: actor.agencyId,
      campaign: campaignFilter,
      OR: [
        { type: 'adjustment', status: 'pending_approval', resolvesMovementId: null },
        { type: { in: ['transfer', 'return'] }, status: 'disputed', resolvedBy: { none: {} } },
      ],
    },
    include: { ...repo.movementInclude, ...withCampaign },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const result = { adjustments: [], disputes: [] };
  for (const row of open) {
    const holders =
      row.type === 'adjustment'
        ? [row.fromLocation.userId]
        : [row.fromLocation.userId, row.toLocation.userId];
    const involved =
      row.type === 'adjustment'
        ? [row.createdById]
        : [row.createdById, row.confirmedById].filter(Boolean);
    if (!(await policies.canApproveStockAction(actor, row.campaign, holders, undefined, involved)))
      continue;
    (row.type === 'adjustment' ? result.adjustments : result.disputes).push(decorate(row));
  }
  return result;
}
