// Fixtures for the inventory tests: a world with every role, active campaigns with staff and
// assignments, and thin helpers over the stock endpoints.
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { buildUserActor } from '../../../core/auth/actor.js';
import { createGiftEntitlement, createSale, day } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';
import { FIXED_STOCK_LOCATIONS } from '../../campaigns/campaigns.repository.js';
import { createWorld, offsetDate, root } from '../../campaigns/__tests__/fixtures.js';

export { root };
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');

export async function createStockWorld(app) {
  const w = await createWorld(app);
  w.actor = (name) => buildUserActor(w.people[name]);

  /** `call(actor, method, path, body, { key, headers })` with a fresh Idempotency-Key by default. */
  w.call = (actor, method, path, body, { key = randomUUID(), attach } = {}) => {
    const req = request(app)[method](root + path);
    const auth = typeof actor === 'string' ? w.auth[actor] : actor;
    if (auth) req.set(auth);
    if (method === 'post') req.set('Idempotency-Key', key);
    if (attach) {
      for (const [field, value] of Object.entries(body)) {
        req.field(field, typeof value === 'string' ? value : JSON.stringify(value));
      }
      return req.attach('file', attach.buffer, attach.options);
    }
    return method === 'get' || body === undefined ? req : req.send(body);
  };
  w.ok = async (req, status = 200) => {
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body.data;
  };
  w.refused = async (req, status, code) => {
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    expect(res.body.error.code).toBe(code);
    return res.body.error.details;
  };

  /** An active (by default) campaign with regional manager and supervisor on staff and one Animateur. */
  w.campaign = async ({ status = 'active', ...data } = {}) => {
    const built = await w.readyCampaign({ status, ...data });
    await prisma.stockLocation.createMany({
      data: FIXED_STOCK_LOCATIONS.map((kind) => ({
        agencyId: w.agency.id,
        campaignId: built.campaign.id,
        kind,
      })),
    });
    const animateurAuth = bearer((await login(app, built.animateur)).accessToken);
    const assignment = await prisma.assignment.findFirstOrThrow({
      where: { campaignId: built.campaign.id },
    });
    return { ...built, animateurAuth, assignment, id: built.campaign.id };
  };

  /** Another Animateur supervised by `supervisor`, approved for the campaign period. */
  w.extraAnimateur = async (built, supervisorId = w.people.supervisor.id) => {
    const animateur = await createUserWithPassword(w.agency.id, { role: 'animateur' });
    await prisma.assignment.create({
      data: {
        agencyId: w.agency.id,
        campaignId: built.campaign.id,
        animateurId: animateur.id,
        pointOfSaleId: built.pointOfSale.id,
        supervisorId,
        proposedById: w.people.director.id,
        startDate: built.campaign.startDate,
        endDate: built.campaign.endDate,
        status: 'approved',
      },
    });
    return {
      animateur,
      auth: bearer((await login(app, animateur)).accessToken),
      actor: buildUserActor(animateur),
    };
  };

  w.stockIn = (built, lines, actor = 'director') =>
    w.ok(
      w.call(actor, 'post', `/campaigns/${built.id}/stock/stock-in`, {
        reference: 'BL-' + Math.random().toString(36).slice(2, 8),
        lines,
      }),
      201,
    );
  w.transfer = (built, actor, recipient, lines) =>
    w.ok(
      w.call(actor, 'post', `/campaigns/${built.id}/stock/transfers`, {
        recipientUserId: recipient.id,
        lines,
      }),
      201,
    );
  w.confirm = (actor, movement, received) =>
    w.ok(
      w.call(actor, 'post', `/stock/transfers/${movement.id}/confirm`, {
        lines: received.map(([stockItemId, quantityReceived]) => ({
          stockItemId,
          quantityReceived,
        })),
      }),
    );

  /** Quantity of `item` at the location of `kind` (and holder user) of the campaign. */
  w.balance = async (built, kind, item, user) => {
    const location = await prisma.stockLocation.findFirst({
      where: { campaignId: built.id, kind, userId: user?.id ?? null },
    });
    if (!location) return 0;
    const row = await prisma.stockBalance.findUnique({
      where: { locationId_stockItemId: { locationId: location.id, stockItemId: item.id } },
    });
    return row?.quantity ?? 0;
  };
  /** Ledger entries of a movement as sorted `kind[:name]=delta` strings, for exact assertions. */
  w.ledger = async (movementId) => {
    const rows = await prisma.stockLedgerEntry.findMany({
      where: { movementId },
      include: { location: { include: { user: true } } },
      orderBy: { id: 'asc' },
    });
    return rows.map(
      (row) =>
        `${row.location.kind}${row.location.user ? ':' + row.location.user.role : ''}=${row.quantityDelta}`,
    );
  };
  w.sumOfBalances = async (built, item) =>
    (
      await prisma.stockBalance.aggregate({
        where: { stockItemId: item.id, location: { campaignId: built.id } },
        _sum: { quantity: true },
      })
    )._sum.quantity ?? 0;

  /** A sale and a pending 1-unit entitlement of `item` for the campaign's Animateur. */
  w.entitlement = async (built, item, quantity = 1) => {
    const ruleSet = await prisma.ruleSet.findFirstOrThrow({
      where: { campaignId: built.id, status: 'approved' },
    });
    const ctx = {
      agency: w.agency,
      client: w.client,
      campaign: built.campaign,
      pointOfSale: built.pointOfSale,
      animateur: built.animateur,
      supervisor: w.people.supervisor,
      ruleSet,
    };
    const sale = await createSale(ctx, {
      assignmentId: built.assignment.id,
      workDate: day(offsetDate(0)),
    });
    const entitlement = await createGiftEntitlement(ctx, sale);
    return prisma.giftEntitlement.update({
      where: { id: entitlement.id },
      data: { stockItemId: item.id, quantity },
    });
  };
  return w;
}
