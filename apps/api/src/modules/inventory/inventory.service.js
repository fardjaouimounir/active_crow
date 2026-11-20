// Business rules of the gift and sample ledger (M8). Every function runs inside the caller's
// transaction (`tx`, opened by the idempotency runner or by the sales module) and posts through the
// ledger engine; none of them writes a balance directly (BR-40).
import { can, ERROR_CODES, PROOF_REQUIRED_REASONS, STOCK_STATUS_GATES } from '@fieldflow/shared';
import { auditService } from '../../core/audit/index.js';
import { ScopeService } from '../../core/authz/index.js';
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/index.js';
import { events } from '../../core/events/index.js';
import { clock } from '../../core/time/clock.js';
import { fileService } from '../files/files.service.js';
import {
  getOrCreateHolderLocation,
  getOrCreateLocation,
  InsufficientStockError,
  lockBalances,
  post,
} from './ledger.js';
import * as policies from './inventory.policies.js';
import * as repo from './inventory.repository.js';

const rule = (code, details, status = 422) =>
  new AppError({ status, code, message: code.toLowerCase().replaceAll('_', ' '), details });
const MOVEMENT_TYPES_WITH_RECIPIENT = new Set(['transfer', 'return']);

async function campaignFor(tx, actor, campaignId) {
  const campaign = await repo.findCampaign(tx, ScopeService.resolve(actor), campaignId);
  if (!campaign) throw new NotFoundError();
  return campaign;
}

function gate(campaign, key) {
  const allowed = STOCK_STATUS_GATES[key];
  if (!allowed.includes(campaign.status))
    throw rule(ERROR_CODES.MOVEMENT_NOT_ALLOWED_IN_STATUS, { status: campaign.status, allowed });
}

/** ITEM_NOT_OF_CLIENT: every line's item belongs to the campaign's client (BR-43). */
async function assertItems(tx, campaign, lines, activeOnly = false) {
  const ids = lines.map((line) => line.stockItemId);
  const found = await repo.clientStockItems(tx, campaign, ids, activeOnly);
  if (found.length !== ids.length) {
    const known = new Set(found.map(({ id }) => id));
    throw rule(ERROR_CODES.ITEM_NOT_OF_CLIENT, {
      stockItemIds: ids.filter((id) => !known.has(id)),
    });
  }
}

const fixed = (tx, campaign, kind) =>
  getOrCreateLocation(tx, { agencyId: campaign.agencyId, campaignId: campaign.id, kind });
const holder = (tx, campaign, userId) =>
  getOrCreateHolderLocation(tx, { agencyId: campaign.agencyId, campaignId: campaign.id, userId });
/** Director and general manager give from the warehouse; everyone else from their own holder location. */
const ownLocation = (tx, actor, campaign) =>
  policies.isAgencyWide(actor) ? fixed(tx, campaign, 'warehouse') : holder(tx, campaign, actor.id);

const legsOf = (movement, fromLocationId, toLocationId, only) =>
  movement.lines
    .filter((line) => !only || only.has(line.id))
    .map((line) => ({
      lineId: line.id,
      stockItemId: line.stockItemId,
      fromLocationId,
      toLocationId,
      quantity: line.quantity,
    }));

const record = (tx, actor, action, movement, extra = {}) =>
  auditService.record(tx, {
    actor,
    action,
    entityType: 'stock_movement',
    entityId: movement.id,
    after: {
      campaignId: movement.campaignId,
      type: movement.type,
      status: movement.status,
      reference: movement.reference ?? undefined,
      lines: movement.lines.map(({ stockItemId, quantity, quantityReceived }) => ({
        stockItemId,
        quantity,
        quantityReceived: quantityReceived ?? undefined,
      })),
      ...extra,
    },
  });

const announce = (tx, actor, name, movement, extra = {}) =>
  events.emit(tx, name, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    campaignId: movement.campaignId,
    movementId: movement.id,
    ...extra,
  });

async function view(tx, actor, movementId) {
  const row = await repo.findMovement(tx, { id: movementId, agencyId: actor.agencyId });
  return repo.serializeMovement(row);
}

/**
 * Loads a movement the actor may act on, locking its row first (so confirm / cancel / decisions on
 * the same movement are serialised). Out of scope ⇒ 404.
 */
async function lockedMovement(tx, actor, movementId) {
  const scope = ScopeService.resolve(actor);
  const known = await repo.findMovementCampaign(tx, actor.agencyId, movementId);
  if (!known) throw new NotFoundError();
  const holderIds = await policies.holderUserIdsInScope(tx, actor, known.campaign.id);
  await repo.lockMovement(tx, actor.agencyId, movementId);
  const movement = await repo.findMovement(tx, {
    AND: [{ id: movementId }, repo.movementAccess(scope, holderIds, actor.role)],
  });
  if (!movement) throw new NotFoundError();
  return { movement, campaign: known.campaign };
}

// ── Stock-in ────────────────────────────────────────────────────────────────────────────────

/** FR-080: external → warehouse, posted at once. */
export async function stockIn(tx, actor, campaignId, body, proof) {
  const campaign = await campaignFor(tx, actor, campaignId);
  gate(campaign, 'stock_in');
  await assertItems(tx, campaign, body.lines, true);
  const proofFile = proof
    ? await fileService.store(tx, { actor, kind: 'stock_document', buffer: proof })
    : null;
  const external = await fixed(tx, campaign, 'external');
  const warehouse = await fixed(tx, campaign, 'warehouse');
  const movement = await repo.createMovement(tx, campaign, actor, {
    type: 'stock_in',
    status: 'posted',
    fromLocationId: external.id,
    toLocationId: warehouse.id,
    reference: body.reference,
    note: body.note,
    proofFileId: proofFile?.id,
    lines: body.lines,
  });
  await post(tx, movement, legsOf(movement, external.id, warehouse.id));
  await record(tx, actor, 'inventory.stock_in', movement);
  return view(tx, actor, movement.id);
}

// ── Transfers and returns (pending → confirmed / disputed / cancelled) ───────────────────────

async function startShipment(tx, actor, campaign, { type, to, body }) {
  await assertItems(tx, campaign, body.lines);
  const from = await ownLocation(tx, actor, campaign);
  const inTransit = await fixed(tx, campaign, 'in_transit');
  const movement = await repo.createMovement(tx, campaign, actor, {
    type,
    status: 'pending',
    fromLocationId: from.id,
    toLocationId: to.id,
    note: body.note,
    lines: body.lines,
  });
  await post(tx, movement, legsOf(movement, from.id, inTransit.id));
  await record(tx, actor, `inventory.${type}_created`, movement);
  announce(tx, actor, 'stock.transfer_created', movement);
  return view(tx, actor, movement.id);
}

/** FR-080, BR-42: sender → in transit, waiting for the recipient's confirmation. */
export async function transfer(tx, actor, campaignId, body) {
  const campaign = await campaignFor(tx, actor, campaignId);
  gate(campaign, 'transfer');
  const options = await policies.recipientsFor(tx, actor, campaign, 'down');
  if (!options.some((option) => option.userId === body.recipientUserId))
    throw rule(ERROR_CODES.INVALID_RECIPIENT, { recipientUserId: body.recipientUserId });
  const to = await holder(tx, campaign, body.recipientUserId);
  return startShipment(tx, actor, campaign, { type: 'transfer', to, body });
}

/** Return up the chain (same flow as a transfer) or back to the client (director, posted at once). */
export async function giveBack(tx, actor, campaignId, body) {
  const campaign = await campaignFor(tx, actor, campaignId);
  gate(campaign, 'return');
  if (body.destination === 'client') {
    if (actor.role !== 'director') throw new ForbiddenError();
    await assertItems(tx, campaign, body.lines);
    const warehouse = await fixed(tx, campaign, 'warehouse');
    const external = await fixed(tx, campaign, 'external');
    const movement = await repo.createMovement(tx, campaign, actor, {
      type: 'return',
      status: 'posted',
      fromLocationId: warehouse.id,
      toLocationId: external.id,
      reference: body.reference,
      note: body.note,
      lines: body.lines,
    });
    await post(tx, movement, legsOf(movement, warehouse.id, external.id));
    await record(tx, actor, 'inventory.return_to_client', movement);
    return view(tx, actor, movement.id);
  }
  const options = await policies.recipientsFor(tx, actor, campaign, 'up');
  const valid =
    body.destination === 'warehouse'
      ? options.some((option) => option.kind === 'warehouse')
      : options.some((option) => option.userId === body.recipientUserId);
  if (!valid) throw rule(ERROR_CODES.INVALID_RECIPIENT, { destination: body.destination });
  const to =
    body.destination === 'warehouse'
      ? await fixed(tx, campaign, 'warehouse')
      : await holder(tx, campaign, body.recipientUserId);
  return startShipment(tx, actor, campaign, { type: 'return', to, body });
}

const isRecipient = (actor, movement) =>
  movement.toLocation.userId === actor.id ||
  (movement.toLocation.kind === 'warehouse' && can(actor.role, 'inventory.confirm'));

function assertShipment(movement, status) {
  if (!MOVEMENT_TYPES_WITH_RECIPIENT.has(movement.type) || movement.status !== status)
    throw rule(ERROR_CODES.TRANSFER_NOT_PENDING, { status: movement.status });
}

function sameItems(requested, movement, path) {
  const wanted = new Set(movement.lines.map((line) => line.stockItemId));
  const given = requested.map((line) => line.stockItemId);
  if (given.length !== wanted.size || !given.every((id) => wanted.has(id)))
    throw new ValidationError([{ path, message: 'Give one entry for each line of the movement' }]);
}

/** FR-082, E-09: the recipient states what arrived; less than sent opens a dispute. */
export async function confirm(tx, actor, movementId, body) {
  const { movement, campaign } = await lockedMovement(tx, actor, movementId);
  if (!isRecipient(actor, movement)) throw rule(ERROR_CODES.NOT_RECIPIENT, undefined, 403);
  assertShipment(movement, 'pending');
  gate(campaign, 'settle');
  sameItems(body.lines, movement, 'body.lines');
  const received = new Map(body.lines.map((line) => [line.stockItemId, line.quantityReceived]));
  for (const line of movement.lines) {
    if (received.get(line.stockItemId) > line.quantity) {
      throw rule(ERROR_CODES.QUANTITY_EXCEEDS_SENT, {
        stockItemId: line.stockItemId,
        sent: line.quantity,
        received: received.get(line.stockItemId),
      });
    }
  }
  const inTransit = await fixed(tx, campaign, 'in_transit');
  const legs = [];
  for (const line of movement.lines) {
    const quantity = received.get(line.stockItemId);
    await tx.stockMovementLine.update({
      where: { id: line.id },
      data: { quantityReceived: quantity },
    });
    if (quantity > 0)
      legs.push({
        lineId: line.id,
        stockItemId: line.stockItemId,
        fromLocationId: inTransit.id,
        toLocationId: movement.toLocation.id,
        quantity,
      });
  }
  if (legs.length) await post(tx, { ...movement, ...campaignIds(campaign) }, legs);
  const complete = movement.lines.every((line) => received.get(line.stockItemId) === line.quantity);
  await tx.stockMovement.update({
    where: { id: movement.id },
    data: {
      status: complete ? 'confirmed' : 'disputed',
      confirmedById: actor.id,
      confirmedAt: clock.now(),
    },
  });
  const after = await repo.findMovement(tx, { id: movement.id, agencyId: actor.agencyId });
  await record(tx, actor, 'inventory.transfer_confirmed', after);
  if (!complete) announce(tx, actor, 'stock.transfer_disputed', movement);
  return repo.serializeMovement(after);
}

const campaignIds = (campaign) => ({ agencyId: campaign.agencyId, campaignId: campaign.id });

/** The sender takes back a shipment nobody has confirmed yet. */
export async function cancel(tx, actor, movementId) {
  const { movement, campaign } = await lockedMovement(tx, actor, movementId);
  if (movement.createdBy.id !== actor.id) throw new ForbiddenError();
  assertShipment(movement, 'pending');
  gate(campaign, 'settle');
  const inTransit = await fixed(tx, campaign, 'in_transit');
  await post(
    tx,
    { ...movement, ...campaignIds(campaign) },
    legsOf(movement, inTransit.id, movement.fromLocation.id),
  );
  await tx.stockMovement.update({ where: { id: movement.id }, data: { status: 'cancelled' } });
  await record(tx, actor, 'inventory.transfer_cancelled', { ...movement, status: 'cancelled' });
  return view(tx, actor, movement.id);
}

// ── Disputes and adjustments ────────────────────────────────────────────────────────────────

/**
 * Decides what happens to the units of a disputed shipment that never arrived: back to the sender
 * or written off as a loss. One adjustment movement, posted at once, linked to the dispute.
 */
export async function resolveDispute(tx, actor, movementId, body) {
  const { movement, campaign } = await lockedMovement(tx, actor, movementId);
  if (!MOVEMENT_TYPES_WITH_RECIPIENT.has(movement.type) || movement.status !== 'disputed')
    throw rule(ERROR_CODES.TRANSFER_NOT_DISPUTED, { status: movement.status });
  if (movement.resolvedBy.length) throw rule(ERROR_CODES.DISPUTE_ALREADY_RESOLVED, undefined, 409);
  gate(campaign, 'settle');
  const parties = [movement.fromLocation.userId, movement.toLocation.userId];
  // The warehouse has no holder user: whoever sent or confirmed the shipment is a party too.
  const involved = [movement.createdById, movement.confirmedById].filter(Boolean);
  if (!(await policies.canApproveStockAction(actor, campaign, parties, tx, involved)))
    throw rule(ERROR_CODES.NOT_ADJUSTMENT_APPROVER, undefined, 403);

  const missing = movement.lines
    .map((line) => ({ ...line, remainder: line.quantity - (line.quantityReceived ?? 0) }))
    .filter((line) => line.remainder > 0);
  sameItems(body.lines, { lines: missing }, 'body.lines');
  const decision = new Map(body.lines.map((line) => [line.stockItemId, line.decision]));
  const inTransit = await fixed(tx, campaign, 'in_transit');
  const losses = await fixed(tx, campaign, 'losses');
  const anyLoss = [...decision.values()].includes('loss');
  const resolution = await repo.createMovement(tx, campaign, actor, {
    type: 'adjustment',
    status: 'posted',
    fromLocationId: inTransit.id,
    toLocationId: anyLoss ? losses.id : movement.fromLocation.id,
    resolvesMovementId: movement.id,
    note: body.note,
    approvedById: actor.id,
    approvedAt: clock.now(),
    lines: missing.map((line) => ({ stockItemId: line.stockItemId, quantity: line.remainder })),
  });
  await post(
    tx,
    resolution,
    resolution.lines.map((line) => ({
      lineId: line.id,
      stockItemId: line.stockItemId,
      fromLocationId: inTransit.id,
      toLocationId:
        decision.get(line.stockItemId) === 'loss' ? losses.id : movement.fromLocation.id,
      quantity: line.quantity,
    })),
  );
  await record(tx, actor, 'inventory.dispute_resolved', resolution, {
    resolves: movement.id,
    decisions: Object.fromEntries(decision),
  });
  return view(tx, actor, resolution.id);
}

/** BR-44 / E-10: asks to write off stock a holder can no longer account for. Nothing is posted yet. */
export async function requestAdjustment(tx, actor, campaignId, body, proof) {
  const campaign = await campaignFor(tx, actor, campaignId);
  gate(campaign, 'settle');
  const holderUserId = body.holderUserId ?? actor.id;
  const visible = await policies.holderUserIdsInScope(tx, actor, campaign.id);
  if (visible && !visible.has(holderUserId)) throw new NotFoundError();
  const location = await tx.stockLocation.findFirst({
    where: { agencyId: campaign.agencyId, campaignId, kind: 'holder', userId: holderUserId },
  });
  if (!location) throw new NotFoundError();
  if (PROOF_REQUIRED_REASONS.includes(body.reason) && !proof)
    throw rule(ERROR_CODES.PROOF_REQUIRED, { reason: body.reason });
  await assertItems(tx, campaign, body.lines);
  await assertAvailable(tx, location, body.lines);
  const proofFile = proof
    ? await fileService.store(tx, { actor, kind: 'stock_adjustment_proof', buffer: proof })
    : null;
  const losses = await fixed(tx, campaign, 'losses');
  const movement = await repo.createMovement(tx, campaign, actor, {
    type: 'adjustment',
    status: 'pending_approval',
    fromLocationId: location.id,
    toLocationId: losses.id,
    // The reason code lives in `reference`: the movement has no dedicated column for it.
    reference: body.reason,
    note: body.note,
    proofFileId: proofFile?.id,
    lines: body.lines,
  });
  await record(tx, actor, 'inventory.adjustment_requested', movement, { holderUserId });
  announce(tx, actor, 'stock.adjustment_requested', movement);
  return view(tx, actor, movement.id);
}

async function assertAvailable(tx, location, lines) {
  const balances = await tx.stockBalance.findMany({
    where: { locationId: location.id, stockItemId: { in: lines.map((line) => line.stockItemId) } },
    select: { stockItemId: true, quantity: true },
  });
  const available = new Map(balances.map((row) => [row.stockItemId, row.quantity]));
  for (const line of lines) {
    const have = available.get(line.stockItemId) ?? 0;
    if (have < line.quantity)
      throw new InsufficientStockError({
        location: { id: location.id, kind: location.kind, userId: location.userId },
        stockItemId: line.stockItemId,
        available: have,
        requested: line.quantity,
      });
  }
}

/** Approving posts holder −q, losses +q; rejecting posts nothing. Never the holder themselves. */
export async function decideAdjustment(tx, actor, movementId, decision, body) {
  const { movement, campaign } = await lockedMovement(tx, actor, movementId);
  if (
    movement.type !== 'adjustment' ||
    movement.resolvesMovementId ||
    movement.status !== 'pending_approval'
  )
    throw rule(ERROR_CODES.ADJUSTMENT_NOT_PENDING, { status: movement.status });
  gate(campaign, 'settle');
  const requester = [movement.createdById];
  if (
    !(await policies.canApproveStockAction(
      actor,
      campaign,
      movement.fromLocation.userId,
      tx,
      requester,
    ))
  )
    throw rule(ERROR_CODES.NOT_ADJUSTMENT_APPROVER, undefined, 403);
  const approved = decision === 'approve';
  if (approved)
    await post(
      tx,
      { ...movement, ...campaignIds(campaign) },
      legsOf(movement, movement.fromLocation.id, movement.toLocation.id),
    );
  await tx.stockMovement.update({
    where: { id: movement.id },
    data: {
      status: approved ? 'posted' : 'rejected',
      approvedById: actor.id,
      approvedAt: clock.now(),
    },
  });
  await record(
    tx,
    actor,
    `inventory.adjustment_${approved ? 'approved' : 'rejected'}`,
    {
      ...movement,
      status: approved ? 'posted' : 'rejected',
    },
    { decisionNote: body.note },
  );
  announce(tx, actor, 'stock.adjustment_decided', movement, {
    decision: approved ? 'approved' : 'rejected',
  });
  return view(tx, actor, movement.id);
}

// ── Distribution (called by the sales module) ───────────────────────────────────────────────

/**
 * BR-32: the Animateur hands a gift entitlement to the customer from their own balance. Posts
 * holder −q, customers +q and marks the entitlement `distributed`. A balance that is too low is a
 * result, not an exception, so the sales transaction can record the sale and mark the entitlement
 * `undelivered` (E-02). The unique index on `gift_entitlement_id` is the last line of defence
 * against a second distribution.
 * @returns {Promise<{ ok: true, movementId: string } | { ok: false, code: 'INSUFFICIENT_STOCK', details: object }>}
 */
export async function distribute(tx, { actor, giftEntitlementId }) {
  const lookup = await tx.giftEntitlement.findFirst({
    where: { id: giftEntitlementId, agencyId: actor.agencyId },
    select: { campaignId: true, saleId: true },
  });
  if (!lookup) throw new NotFoundError();
  await tx.$queryRaw`SELECT id FROM campaigns WHERE id = ${lookup.campaignId}::uuid
    AND agency_id = ${actor.agencyId}::uuid FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM sales WHERE id = ${lookup.saleId}::uuid
    AND agency_id = ${actor.agencyId}::uuid FOR UPDATE`;
  await tx.$queryRaw`
    SELECT id FROM gift_entitlements
    WHERE id = ${giftEntitlementId}::uuid AND agency_id = ${actor.agencyId}::uuid FOR UPDATE`;
  const entitlement = await tx.giftEntitlement.findFirst({
    where: { id: giftEntitlementId, agencyId: actor.agencyId },
    include: {
      campaign: { select: { status: true } },
      sale: { select: { status: true, assignment: { select: { animateurId: true } } } },
    },
  });
  if (!entitlement) throw new NotFoundError();
  if (
    actor.role !== 'animateur' ||
    entitlement.sale.assignment.animateurId !== actor.id ||
    entitlement.campaign.status !== 'active' ||
    entitlement.sale.status !== 'recorded'
  ) {
    throw rule(ERROR_CODES.ENTITLEMENT_NOT_DISTRIBUTABLE, undefined, 422);
  }
  if (!['pending', 'undelivered'].includes(entitlement.status))
    throw rule(ERROR_CODES.ENTITLEMENT_NOT_DISTRIBUTABLE, { status: entitlement.status }, 409);
  const campaign = { id: entitlement.campaignId, agencyId: entitlement.agencyId };
  const from = await holder(tx, campaign, actor.id);
  const customers = await fixed(tx, campaign, 'customers');
  const line = { stockItemId: entitlement.stockItemId, quantity: entitlement.quantity };
  // Checked under the balance row's lock and before anything is written, so a refusal leaves no
  // half-made movement behind and a concurrent drain cannot slip in between check and posting.
  await lockDistributionBalances(tx, actor, campaign, [line]);
  try {
    await assertAvailable(tx, from, [line]);
  } catch (err) {
    if (err instanceof InsufficientStockError)
      return { ok: false, code: err.code, details: err.details };
    throw err;
  }
  const movement = await repo.createMovement(tx, campaign, actor, {
    type: 'distribution',
    status: 'posted',
    fromLocationId: from.id,
    toLocationId: customers.id,
    giftEntitlementId,
    lines: [line],
  });
  await post(tx, movement, legsOf(movement, from.id, customers.id));
  await tx.giftEntitlement.update({
    where: { id: giftEntitlementId },
    data: { status: 'distributed' },
  });
  await record(tx, actor, 'inventory.distribution', movement, { giftEntitlementId });
  return { ok: true, movementId: movement.id };
}

export async function lockDistributionBalances(tx, actor, campaign, gifts) {
  if (!gifts.length) return;
  const from = await holder(tx, campaign, actor.id);
  const customers = await fixed(tx, campaign, 'customers');
  await lockBalances(
    tx,
    { agencyId: campaign.agencyId, campaignId: campaign.id },
    gifts.map(({ stockItemId, quantity }) => ({
      fromLocationId: from.id,
      toLocationId: customers.id,
      stockItemId,
      quantity,
    })),
  );
}
