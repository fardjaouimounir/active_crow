// The verifiable Tombola draw (FR-092, FR-093, BR-51, BR-52, E-15). The client draws from its
// portal; the director may draw on its behalf. Registration closing commits to the entry list (a
// database trigger stores the hash and the count); the draw recomputes the list, refuses on any
// mismatch and stores everything needed to replay it with packages/shared tombolaDraw.js.
import { randomBytes } from 'node:crypto';
import { DRAW_ALGORITHM, entriesHash, runDraw } from '@fieldflow/shared';
import { logger } from '../../config/logger.js';
import { auditService } from '../../core/audit/index.js';
import { ScopeService } from '../../core/authz/index.js';
import { campaignWhere } from '../../core/authz/scopeFilters.js';
import { BusinessRuleError, NotFoundError, ValidationError } from '../../core/errors/index.js';
import { clock } from '../../core/time/clock.js';
import { prisma } from '../../db/client.js';
import { withTransaction } from '../../db/transaction.js';
import { maskedCustomer, problem, required } from './sales.policies.js';
import * as repo from './tombola.repository.js';

const NOT_DRAWN = 'TOMBOLA_NOT_DRAWN';

/** Client users and agency-wide staff only; everybody else gets 404. */
function portalScope(actor) {
  const scope = ScopeService.resolve(actor);
  if (scope.level !== 'client' && scope.level !== 'agency') throw new NotFoundError();
  return scope;
}

const visible = (scope, id) => ({
  id,
  agencyId: scope.agencyId,
  campaign: campaignWhere(scope),
});

async function load(db, scope, id) {
  return required(
    await db.tombola.findFirst({
      where: visible(scope, id),
      include: { campaign: { select: { id: true, name: true, code: true } }, draw: true },
    }),
  );
}

async function entryNumbers(db, tombolaId) {
  const rows = await db.tombolaEntry.findMany({
    where: { tombolaId, status: 'valid' },
    orderBy: { entryNumber: 'asc' },
    select: { entryNumber: true },
  });
  return rows.map(({ entryNumber }) => entryNumber);
}

async function drawnBy(draw) {
  const user = await prisma.user.findUnique({
    where: { id: draw.drawnById },
    select: { role: true, fullName: true },
  });
  return user?.role === 'client'
    ? { kind: 'client', name: user.fullName }
    : { kind: 'agency', name: null };
}

async function view(db, tombola) {
  const { draw, campaign, ...row } = tombola;
  const validEntries = await db.tombolaEntry.count({
    where: { tombolaId: row.id, status: 'valid' },
  });
  return {
    id: row.id,
    campaign,
    name: row.name,
    status: row.status,
    entryBasis: row.entryBasis,
    entriesPerBasis: row.entriesPerBasis,
    maxEntriesPerCustomer: row.maxEntriesPerCustomer,
    requiresPurchase: row.requiresPurchase,
    registrationEndsAt: row.registrationEndsAt,
    drawScheduledAt: row.drawScheduledAt,
    winnersCount: row.winnersCount,
    reservesCount: row.reservesCount,
    entryCount: validEntries,
    // Published as soon as registration closes (set by the database trigger).
    commitment: row.entriesHash
      ? {
          entriesHash: row.entriesHash,
          eligibleCount: row.eligibleCount,
          committedAt: row.committedAt,
        }
      : null,
    draw: draw
      ? {
          drawnAt: draw.drawnAt,
          drawnBy: await drawnBy(draw),
          algorithm: draw.algorithm,
          eligibleCount: draw.eligibleCount,
          entriesHash: draw.entriesHash,
        }
      : null,
  };
}

export async function get(actor, id) {
  const scope = portalScope(actor);
  return view(prisma, await load(prisma, scope, id));
}

export function draw(actor, id, input, req) {
  const scope = portalScope(actor);
  return withTransaction(async (tx) => {
    await repo.lock(tx, scope, [id]);
    const tombola = await load(tx, scope, id);
    if (tombola.status === 'drawn' || tombola.draw)
      throw problem('TOMBOLA_ALREADY_DRAWN', 409, 'This Tombola was already drawn');
    if (tombola.status !== 'closed')
      throw problem('TOMBOLA_NOT_CLOSED', 409, 'Registration is still open');

    const numbers = await entryNumbers(tx, id);
    const hash = await entriesHash(numbers);
    if (hash !== tombola.entriesHash || numbers.length !== tombola.eligibleCount) {
      // Never draw on a list that differs from the published commitment.
      logger.error({ tombolaId: id }, 'Tombola entry list differs from its commitment');
      throw new Error('Tombola commitment mismatch');
    }
    if (numbers.length < tombola.winnersCount)
      throw problem('NOT_ENOUGH_ENTRIES', 422, 'There are fewer eligible entries than winners', {
        eligible: numbers.length,
        winners: tombola.winnersCount,
      });
    const ranks = input.prizes.map(({ rank }) => rank).sort((a, b) => a - b);
    if (ranks.length !== tombola.winnersCount || ranks.some((rank, index) => rank !== index + 1))
      throw new ValidationError([
        { path: 'body.prizes', message: 'One prize label for each winner rank' },
      ]);

    const serverRandom = randomBytes(32).toString('hex');
    const clientNonce = input.clientNonce ?? '';
    const result = await runDraw({
      entryNumbers: numbers,
      serverRandom,
      clientNonce,
      winnersCount: tombola.winnersCount,
      reservesCount: tombola.reservesCount,
    });
    const entries = await tx.tombolaEntry.findMany({
      where: { tombolaId: id, entryNumber: { in: [...result.winners, ...result.reserves] } },
      select: { id: true, entryNumber: true },
    });
    const entryId = new Map(entries.map((entry) => [entry.entryNumber, entry.id]));
    const created = await tx.tombolaDraw.create({
      data: {
        agencyId: scope.agencyId,
        tombolaId: id,
        seed: result.seed,
        algorithm: DRAW_ALGORITHM,
        eligibleCount: result.eligibleCount,
        entriesHash: result.entriesHash,
        serverRandom,
        clientNonce,
        drawnById: actor.id,
        drawnAt: clock.now(),
      },
    });
    const label = new Map(input.prizes.map(({ rank, label: text }) => [rank, text]));
    await tx.tombolaWinner.createMany({
      data: [
        ...result.winners.map((number, index) => ({
          rank: index + 1,
          isReserve: false,
          prizeLabel: label.get(index + 1),
          number,
        })),
        ...result.reserves.map((number, index) => ({
          rank: result.winners.length + index + 1,
          isReserve: true,
          prizeLabel: null,
          number,
        })),
      ].map(({ number, ...row }) => ({
        ...row,
        agencyId: scope.agencyId,
        drawId: created.id,
        entryId: entryId.get(number),
      })),
    });
    await tx.tombola.update({ where: { id }, data: { status: 'drawn' } });
    await auditService.record(tx, {
      actor,
      req,
      action: 'tombola.drawn',
      entityType: 'tombola',
      entityId: id,
      after: {
        drawId: created.id,
        algorithm: DRAW_ALGORITHM,
        eligibleCount: result.eligibleCount,
        entriesHash: result.entriesHash,
        winners: result.winners.length,
        reserves: result.reserves.length,
      },
    });
    return view(tx, await load(tx, scope, id));
  });
}

/** Everything needed to recompute the draw, published after it (the server random included). */
export async function verification(actor, id) {
  const scope = portalScope(actor);
  const tombola = await load(prisma, scope, id);
  if (!tombola.draw) throw problem(NOT_DRAWN, 409, 'This Tombola has not been drawn');
  const winners = await prisma.tombolaWinner.findMany({
    where: { drawId: tombola.draw.id },
    orderBy: { rank: 'asc' },
    include: { entry: { select: { entryNumber: true } } },
  });
  const picked = (reserve) =>
    winners.filter((w) => w.isReserve === reserve).map((w) => w.entry.entryNumber);
  return {
    algorithm: tombola.draw.algorithm,
    entryNumbers: await entryNumbers(prisma, id),
    serverRandom: tombola.draw.serverRandom,
    clientNonce: tombola.draw.clientNonce,
    entriesHash: tombola.draw.entriesHash,
    seed: tombola.draw.seed,
    eligibleCount: tombola.draw.eligibleCount,
    winnersCount: tombola.winnersCount,
    reservesCount: tombola.reservesCount,
    winners: picked(false),
    reserves: picked(true),
  };
}

function winnerView(row, customer, prizes) {
  return {
    id: row.id,
    rank: row.rank,
    isReserve: row.isReserve,
    entryNumber: row.entry.entryNumber,
    customer,
    // A promoted reserve receives the prize of the rank it serves.
    prizeLabel: row.prizeLabel ?? (row.servesRank ? prizes.get(row.servesRank) : null) ?? null,
    servesRank: row.servesRank,
    deliveryStatus: row.deliveryStatus,
    deliveredAt: row.deliveredAt,
    unreachableReason: row.unreachableReason,
  };
}

/** Winners and reserves. Clients and the preview get masked contacts; `personal` is audited. */
export async function winners(actor, id, { personal = false } = {}, req) {
  const scope = portalScope(actor);
  const tombola = await load(prisma, scope, id);
  if (!tombola.draw) return { data: [] };
  const full =
    personal && scope.level === 'agency' && ['director', 'general_manager'].includes(actor.role);
  if (personal && !full) throw new NotFoundError();
  const rows = await prisma.tombolaWinner.findMany({
    where: { drawId: tombola.draw.id },
    orderBy: { rank: 'asc' },
    include: {
      entry: {
        select: {
          entryNumber: true,
          customer: { select: { id: true, fullName: true, phone: true } },
        },
      },
    },
  });
  const prizes = new Map(rows.filter((r) => !r.isReserve).map((r) => [r.rank, r.prizeLabel]));
  if (full)
    await withTransaction((tx) =>
      auditService.record(tx, {
        actor,
        req,
        action: 'tombola.winners_personal_read',
        entityType: 'tombola',
        entityId: id,
        after: { count: rows.length },
      }),
    );
  return {
    data: rows.map((row) => {
      const { customer } = row.entry;
      return winnerView(
        row,
        full
          ? { id: customer.id, fullName: customer.fullName, phone: customer.phone }
          : maskedCustomer(customer),
        prizes,
      );
    }),
  };
}

async function lockedWinner(tx, scope, tombolaId, winnerId) {
  await repo.lock(tx, scope, [tombolaId]);
  const tombola = await load(tx, scope, tombolaId);
  if (!tombola.draw) throw problem(NOT_DRAWN, 409, 'This Tombola has not been drawn');
  const winner = required(
    await tx.tombolaWinner.findFirst({ where: { id: winnerId, drawId: tombola.draw.id } }),
  );
  if (winner.deliveryStatus !== 'pending')
    throw problem('WINNER_ALREADY_FINAL', 409, 'This winner is already delivered or unreachable');
  return { tombola, winner };
}

/** A winner who cannot be reached (reason required): the next unused reserve takes the rank (E-15). */
export function markUnreachable(actor, id, winnerId, { reason }, req) {
  const scope = portalScope(actor);
  return withTransaction(async (tx) => {
    const { tombola, winner } = await lockedWinner(tx, scope, id, winnerId);
    const serving = !winner.isReserve || winner.servesRank !== null;
    const rank = winner.isReserve ? winner.servesRank : winner.rank;
    let promoted = null;
    if (serving) {
      promoted = await tx.tombolaWinner.findFirst({
        where: {
          drawId: tombola.draw.id,
          isReserve: true,
          servesRank: null,
          deliveryStatus: 'pending',
          id: { not: winner.id },
        },
        orderBy: { rank: 'asc' },
      });
      if (!promoted) throw problem('NO_RESERVE_LEFT', 422, 'There is no reserve left to promote');
    }
    await tx.tombolaWinner.update({
      where: { id: winner.id },
      data: { deliveryStatus: 'unreachable', unreachableReason: reason },
    });
    if (promoted)
      await tx.tombolaWinner.update({ where: { id: promoted.id }, data: { servesRank: rank } });
    await auditService.record(tx, {
      actor,
      req,
      action: 'tombola.winner_unreachable',
      entityType: 'tombola_winner',
      entityId: winner.id,
      before: { deliveryStatus: 'pending' },
      after: { deliveryStatus: 'unreachable', rank, promotedReserveId: promoted?.id ?? null },
    });
    return {
      id: winner.id,
      deliveryStatus: 'unreachable',
      promotedReserveId: promoted?.id ?? null,
    };
  });
}

export function markDelivered(actor, id, winnerId, { deliveredAt }, req) {
  const scope = portalScope(actor);
  return withTransaction(async (tx) => {
    const { winner } = await lockedWinner(tx, scope, id, winnerId);
    if (winner.isReserve && winner.servesRank === null)
      throw new BusinessRuleError('A reserve that was not promoted cannot receive a prize');
    const at = deliveredAt ? new Date(`${deliveredAt}T12:00:00+01:00`) : clock.now();
    if (at > clock.now()) throw new BusinessRuleError('The delivery date cannot be in the future');
    await tx.tombolaWinner.update({
      where: { id: winner.id },
      data: { deliveryStatus: 'delivered', deliveredAt: at },
    });
    await auditService.record(tx, {
      actor,
      req,
      action: 'tombola.winner_delivered',
      entityType: 'tombola_winner',
      entityId: winner.id,
      before: { deliveryStatus: 'pending' },
      after: { deliveryStatus: 'delivered', deliveredAt: at },
    });
    return { id: winner.id, deliveryStatus: 'delivered', deliveredAt: at };
  });
}
