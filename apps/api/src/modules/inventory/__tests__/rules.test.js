import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { createStockItem, day } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { offsetDate } from '../../campaigns/__tests__/fixtures.js';
import { inventoryReadService } from '../inventoryReadService.js';
import { createStockWorld } from './helpers.js';

const app = createApp();
let w;
let gift;
let photo;

beforeAll(async () => {
  w = await createStockWorld(app);
  gift = await w.gift({ name: 'Mug' });
  photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#c00' } })
    .png()
    .toBuffer();
});

const lines = (...pairs) => pairs.map(([item, quantity]) => ({ stockItemId: item.id, quantity }));
const transferTo = (c, actor, recipient, quantity = 1) =>
  w.call(actor, 'post', `/campaigns/${c.id}/stock/transfers`, {
    recipientUserId: recipient.id,
    lines: lines([gift, quantity]),
  });
/** A campaign whose supervisor holds `quantity` gifts. */
async function supervised(quantity = 20, options) {
  const c = await w.campaign(options);
  await w.stockIn(c, lines([gift, quantity]));
  const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, quantity]));
  await w.confirm('supervisor', transfer, [[gift.id, quantity]]);
  return c;
}

describe('recipients (FR-080)', () => {
  it('lists, per role and direction, only valid counterparts', async () => {
    const c = await w.campaign();
    const ids = async (actor, direction) =>
      (
        await w.ok(
          w.call(actor, 'get', `/campaigns/${c.id}/stock/recipients?direction=${direction}`),
        )
      )
        .map((entry) => entry.userId ?? entry.kind)
        .sort();
    expect(await ids('director', 'down')).toEqual(
      [w.people.regional.id, w.people.supervisor.id].sort(),
    );
    expect(await ids('regional', 'down')).toEqual([w.people.supervisor.id]);
    expect(await ids('supervisor', 'down')).toEqual([c.animateur.id]);
    expect(await ids('director', 'up')).toEqual(['client']);
    expect(await ids('regional', 'up')).toEqual(['warehouse']);
    expect(await ids('supervisor', 'up')).toEqual([w.people.regional.id, 'warehouse'].sort());
    expect(await ids(c.animateurAuth, 'up')).toEqual([w.people.supervisor.id]);
    expect(await ids(c.animateurAuth, 'down')).toEqual([]);
  });

  it('INVALID_RECIPIENT: skipping a level, a stranger, an ended or unapproved assignment', async () => {
    const c = await supervised();
    const invalid = async (actor, recipient) =>
      w.refused(transferTo(c, actor, recipient), 422, 'INVALID_RECIPIENT');
    await invalid('director', c.animateur);
    await invalid('director', w.people.regionalTwo);
    await invalid('regional', w.people.supervisorTwo);
    await invalid('supervisor', w.people.supervisorTwo);
    const other = await w.extraAnimateur(c, w.people.supervisorTwo.id);
    await invalid('supervisor', other.animateur);
    const ended = await w.extraAnimateur(c);
    await prisma.assignment.updateMany({
      where: { animateurId: ended.animateur.id },
      data: { endDate: day(offsetDate(-1)), startDate: day(offsetDate(-3)) },
    });
    await invalid('supervisor', ended.animateur);
    const proposed = await w.extraAnimateur(c);
    await prisma.assignment.updateMany({
      where: { animateurId: proposed.animateur.id },
      data: { status: 'proposed' },
    });
    await invalid('supervisor', proposed.animateur);
    await w.ok(transferTo(c, 'supervisor', c.animateur, 2), 201);
  });

  it('returns: Animateur → own supervisor only; return to client is the director’s', async () => {
    const c = await supervised();
    const give = (actor, body) => w.call(actor, 'post', `/campaigns/${c.id}/stock/returns`, body);
    const back = {
      destination: 'user',
      recipientUserId: w.people.supervisorTwo.id,
      lines: lines([gift, 1]),
    };
    await w.refused(give(c.animateurAuth, back), 422, 'INVALID_RECIPIENT');
    await w.refused(
      give('supervisor', { destination: 'client', reference: 'R', lines: lines([gift, 1]) }),
      403,
      'FORBIDDEN',
    );
    await w.refused(
      give('regional', {
        destination: 'user',
        recipientUserId: w.people.supervisor.id,
        lines: lines([gift, 1]),
      }),
      422,
      'INVALID_RECIPIENT',
    );
    await w.refused(
      give('supervisor', { destination: 'client', lines: lines([gift, 1]) }),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('campaign status gates', () => {
  it('MOVEMENT_NOT_ALLOWED_IN_STATUS per movement type', async () => {
    const draft = await w.campaign({ status: 'draft' });
    await w.refused(
      w.call('director', 'post', `/campaigns/${draft.id}/stock/stock-in`, {
        reference: 'x',
        lines: lines([gift, 1]),
      }),
      422,
      'MOVEMENT_NOT_ALLOWED_IN_STATUS',
    );
    const planning = await w.campaign({ status: 'planning' });
    await w.stockIn(planning, lines([gift, 5]));
    await w.refused(
      transferTo(planning, 'director', w.people.supervisor),
      422,
      'MOVEMENT_NOT_ALLOWED_IN_STATUS',
    );
    const assigned = await w.campaign({ status: 'assigned' });
    await w.stockIn(assigned, lines([gift, 5]));
    await w.ok(transferTo(assigned, 'director', w.people.supervisor), 201);
    await w.refused(
      w.call('director', 'post', `/campaigns/${assigned.id}/stock/returns`, {
        destination: 'client',
        reference: 'r',
        lines: lines([gift, 1]),
      }),
      422,
      'MOVEMENT_NOT_ALLOWED_IN_STATUS',
    );
    const completed = await supervised(5);
    await prisma.campaign.update({ where: { id: completed.id }, data: { status: 'completed' } });
    await w.ok(
      w.call('supervisor', 'post', `/campaigns/${completed.id}/stock/returns`, {
        destination: 'warehouse',
        lines: lines([gift, 1]),
      }),
      201,
    );
    await w.refused(
      transferTo(completed, 'supervisor', completed.animateur),
      422,
      'MOVEMENT_NOT_ALLOWED_IN_STATUS',
    );
  });
});

describe('item and quantity rules', () => {
  it('ITEM_NOT_OF_CLIENT (BR-43) and INSUFFICIENT_STOCK with the available quantity (BR-41)', async () => {
    const c = await supervised(20);
    const foreign = await createStockItem(w.agency.id, w.otherClient.id);
    await w.refused(
      w.call('director', 'post', `/campaigns/${c.id}/stock/stock-in`, {
        reference: 'x',
        lines: lines([foreign, 1]),
      }),
      422,
      'ITEM_NOT_OF_CLIENT',
    );
    const details = await w.refused(
      transferTo(c, 'supervisor', c.animateur, 25),
      422,
      'INSUFFICIENT_STOCK',
    );
    expect(details).toMatchObject({
      available: 20,
      requested: 25,
      stockItemId: gift.id,
      location: { kind: 'holder' },
    });
    expect(await w.balance(c, 'holder', gift, w.people.supervisor)).toBe(20);
  });

  it('rejects zero, fractional, duplicate and oversized lines', async () => {
    const c = await supervised(20);
    const post = (body) =>
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/transfers`, {
        recipientUserId: c.animateur.id,
        ...body,
      });
    await w.refused(post({ lines: lines([gift, 0]) }), 400, 'VALIDATION_FAILED');
    await w.refused(
      post({ lines: [{ stockItemId: gift.id, quantity: 1.5 }] }),
      400,
      'VALIDATION_FAILED',
    );
    await w.refused(post({ lines: lines([gift, 1], [gift, 2]) }), 400, 'VALIDATION_FAILED');
    await w.refused(post({ lines: lines([gift, 100_001]) }), 400, 'VALIDATION_FAILED');
    await w.refused(post({ lines: lines([gift, 1]), extra: true }), 400, 'VALIDATION_FAILED');
  });
});

describe('confirmation', () => {
  it('NOT_RECIPIENT, QUANTITY_EXCEEDS_SENT, TRANSFER_NOT_PENDING', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 10]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 10]));
    const confirm = (actor, quantityReceived, extra = {}) =>
      w.call(actor, 'post', `/stock/transfers/${transfer.id}/confirm`, {
        lines: [{ stockItemId: gift.id, quantityReceived, ...extra }],
      });
    await w.refused(confirm('director', 10), 403, 'NOT_RECIPIENT');
    await w.refused(confirm('regional', 10), 403, 'NOT_RECIPIENT');
    await w.refused(confirm('supervisorTwo', 10), 404, 'NOT_FOUND');
    await w.refused(confirm('supervisor', 11), 422, 'QUANTITY_EXCEEDS_SENT');
    await w.refused(
      w.call('supervisor', 'post', `/stock/transfers/${transfer.id}/confirm`, { lines: [] }),
      400,
      'VALIDATION_FAILED',
    );
    await w.ok(confirm('supervisor', 10));
    await w.refused(confirm('supervisor', 10), 422, 'TRANSFER_NOT_PENDING');
  });

  it('only the sender cancels, and only while pending', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 10]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 10]));
    const cancel = (actor) => w.call(actor, 'post', `/stock/transfers/${transfer.id}/cancel`, {});
    await w.refused(cancel('supervisor'), 403, 'FORBIDDEN');
    await w.ok(cancel('director'));
    await w.refused(cancel('director'), 422, 'TRANSFER_NOT_PENDING');
    await w.refused(
      w.call('supervisor', 'post', `/stock/transfers/${transfer.id}/confirm`, {
        lines: [{ stockItemId: gift.id, quantityReceived: 1 }],
      }),
      422,
      'TRANSFER_NOT_PENDING',
    );
  });
});

describe('adjustments and approval policy (BR-44, E-10)', () => {
  const adjust = (c, actor, body, attach) =>
    w.call(
      actor,
      'post',
      `/campaigns/${c.id}/stock/adjustments`,
      { reason: 'damaged', note: 'Broken in the van', lines: lines([gift, 2]), ...body },
      { attach },
    );

  it('PROOF_REQUIRED for lost and stolen; a photo satisfies it', async () => {
    const c = await supervised();
    await w.refused(adjust(c, 'supervisor', { reason: 'lost' }), 422, 'PROOF_REQUIRED');
    await w.refused(adjust(c, 'supervisor', { reason: 'stolen' }), 422, 'PROOF_REQUIRED');
    const proof = { buffer: photo, options: { filename: 'p.png', contentType: 'image/png' } };
    const movement = await w.ok(adjust(c, 'supervisor', { reason: 'stolen' }, proof), 201);
    expect(movement.proofFileId).toBeTruthy();
    await w.ok(adjust(c, 'supervisor', { reason: 'damaged' }), 201);
    expect((await w.call('director', 'get', `/files/${movement.proofFileId}`)).status).toBe(200);
    expect((await w.call('supervisorTwo', 'get', `/files/${movement.proofFileId}`)).status).toBe(
      404,
    );
  });

  it('nobody approves an adjustment of their own stock; scope limits a regional manager', async () => {
    const c = await supervised();
    await w.transfer(c, 'supervisor', c.animateur, lines([gift, 4]));
    const own = await w.ok(adjust(c, 'supervisor', {}), 201);
    await w.refused(
      w.call('supervisor', 'post', `/stock/adjustments/${own.id}/approve`, {}),
      403,
      'FORBIDDEN',
    );
    // A regional manager asking about their own stock cannot approve it either.
    await w.stockIn(c, lines([gift, 6]));
    const toRegional = await w.transfer(c, 'director', w.people.regional, lines([gift, 6]));
    await w.confirm('regional', toRegional, [[gift.id, 6]]);
    const regionalOwn = await w.ok(adjust(c, 'regional', {}), 201);
    await w.refused(
      w.call('regional', 'post', `/stock/adjustments/${regionalOwn.id}/approve`, {}),
      403,
      'NOT_ADJUSTMENT_APPROVER',
    );
    await w.ok(w.call('director', 'post', `/stock/adjustments/${regionalOwn.id}/approve`, {}));
    // Supervisor of another wilaya: the first regional manager has no authority over them.
    await prisma.campaignWilaya.create({
      data: { campaignId: c.id, agencyId: w.agency.id, wilayaId: 31, requiredAnimateurs: 1 },
    });
    await prisma.campaignStaff.createMany({
      data: [
        {
          campaignId: c.id,
          agencyId: w.agency.id,
          wilayaId: 31,
          userId: w.people.supervisorTwo.id,
          role: 'supervisor',
        },
        {
          campaignId: c.id,
          agencyId: w.agency.id,
          wilayaId: 31,
          userId: w.people.regionalTwo.id,
          role: 'regional_manager',
        },
      ],
    });
    await w.stockIn(c, lines([gift, 3]));
    const toTwo = await w.transfer(c, 'director', w.people.supervisorTwo, lines([gift, 3]));
    await w.confirm('supervisorTwo', toTwo, [[gift.id, 3]]);
    const foreign = await w.ok(adjust(c, 'supervisorTwo', { lines: lines([gift, 1]) }), 201);
    await w.refused(
      w.call('regional', 'post', `/stock/adjustments/${foreign.id}/approve`, {}),
      404,
      'NOT_FOUND',
    );
    await w.ok(w.call('regionalTwo', 'post', `/stock/adjustments/${foreign.id}/approve`, {}));
    // Rejecting needs a reason and a decided adjustment cannot be decided again.
    const again = await w.ok(adjust(c, 'supervisor', {}), 201);
    await w.refused(
      w.call('director', 'post', `/stock/adjustments/${again.id}/reject`, {}),
      400,
      'VALIDATION_FAILED',
    );
    await w.ok(
      w.call('director', 'post', `/stock/adjustments/${again.id}/reject`, { note: 'Not credible' }),
    );
    await w.refused(
      w.call('director', 'post', `/stock/adjustments/${again.id}/approve`, {}),
      422,
      'ADJUSTMENT_NOT_PENDING',
    );
  });

  it('refuses an adjustment beyond the holder’s balance and a holder outside the requester’s scope', async () => {
    const c = await supervised(5);
    await w.refused(
      adjust(c, 'supervisor', { lines: lines([gift, 6]) }),
      422,
      'INSUFFICIENT_STOCK',
    );
    await w.refused(
      adjust(c, 'supervisor', { holderUserId: w.people.regional.id }),
      404,
      'NOT_FOUND',
    );
  });
});

describe('dispute resolution (E-09)', () => {
  it('the parties cannot resolve; decisions must cover every shortfall; loss needs a reason', async () => {
    const c = await supervised(1);
    await w.stockIn(c, lines([gift, 10]));
    const toRegional = await w.transfer(c, 'director', w.people.regional, lines([gift, 10]));
    await w.confirm('regional', toRegional, [[gift.id, 10]]);
    const down = await w.transfer(c, 'regional', w.people.supervisor, lines([gift, 10]));
    const disputed = await w.confirm('supervisor', down, [[gift.id, 7]]);
    expect(disputed.status).toBe('disputed');
    const resolve = (actor, body) =>
      w.call(actor, 'post', `/stock/transfers/${down.id}/resolve`, body);
    const decision = [{ stockItemId: gift.id, decision: 'loss' }];
    await w.refused(
      resolve('regional', { lines: decision, note: 'Lost in transit' }),
      403,
      'NOT_ADJUSTMENT_APPROVER',
    );
    await w.refused(resolve('director', { lines: decision }), 400, 'VALIDATION_FAILED');
    await w.refused(resolve('director', { lines: [] }), 400, 'VALIDATION_FAILED');
    await w.refused(
      w.call('director', 'post', `/stock/transfers/${toRegional.id}/resolve`, {
        lines: decision,
        note: 'x y z',
      }),
      422,
      'TRANSFER_NOT_DISPUTED',
    );
    const resolved = await w.ok(resolve('director', { lines: decision, note: 'Lost in transit' }));
    expect(resolved.lines).toEqual([expect.objectContaining({ quantity: 3 })]);
    const detail = await w.ok(w.call('director', 'get', `/stock/movements/${down.id}`));
    expect(detail.resolutions).toHaveLength(1);
  });

  it('closingBlockers: an unresolved dispute blocks, a resolved one does not (BR-15)', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 10]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 10]));
    await w.confirm('supervisor', transfer, [[gift.id, 8]]);
    const codes = async () =>
      (await inventoryReadService.closingBlockers(prisma, c.id)).map((b) => b.code);
    expect(await codes()).toEqual(['PHYSICAL_STOCK_REMAINING', 'OPEN_STOCK_MOVEMENTS']);
    await w.ok(
      w.call('general', 'post', `/stock/transfers/${transfer.id}/resolve`, {
        lines: [{ stockItemId: gift.id, decision: 'loss' }],
        note: 'Written off',
      }),
    );
    expect(await codes()).toEqual(['PHYSICAL_STOCK_REMAINING']);
    const back = await w.ok(
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/returns`, {
        destination: 'warehouse',
        lines: lines([gift, 8]),
      }),
      201,
    );
    await w.confirm('director', back, [[gift.id, 8]]);
    await w.ok(
      w.call('director', 'post', `/campaigns/${c.id}/stock/returns`, {
        destination: 'client',
        reference: 'RET',
        lines: lines([gift, 8]),
      }),
      201,
    );
    expect(await codes()).toEqual([]);
  });

  it('E-01: holding stock blocks a transfer of the holder, and the organization sees the same balances', async () => {
    const c = await supervised(3);
    const reading = await prisma.$transaction((tx) =>
      inventoryReadService.hasOpenHoldings(tx, w.people.supervisor.id),
    );
    expect(reading.hasHoldings).toBe(true);
    expect(reading.campaigns).toContain(c.campaign.code);
    await prisma.reportingLine.create({
      data: {
        agencyId: w.agency.id,
        userId: w.people.supervisor.id,
        managerId: w.people.regional.id,
        validFrom: day(offsetDate(-2)),
      },
    });
    const rejected = await w.call(
      'director',
      'post',
      `/users/${w.people.supervisor.id}/transfers`,
      {
        newManagerId: w.people.regionalTwo.id,
        effectiveDate: offsetDate(0),
        reason: 'Reassign',
      },
    );
    expect(rejected.body.error?.code, JSON.stringify(rejected.body)).toBe('HOLDER_HAS_STOCK');
  });
});

describe('approval is never by a party (BR-44)', () => {
  it('the requester cannot approve their own request, nor the sender of a shipment resolve its dispute', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 10]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 10]));
    await w.confirm('supervisor', transfer, [[gift.id, 8]]);
    const resolve = (actor) =>
      w.call(actor, 'post', `/stock/transfers/${transfer.id}/resolve`, {
        lines: [{ stockItemId: gift.id, decision: 'loss' }],
        note: 'Written off',
      });
    await w.refused(resolve('director'), 403, 'NOT_ADJUSTMENT_APPROVER');
    await w.ok(resolve('general'));
    const request = await w.ok(
      w.call('director', 'post', `/campaigns/${c.id}/stock/adjustments`, {
        holderUserId: w.people.supervisor.id,
        reason: 'damaged',
        note: 'Wet boxes',
        lines: lines([gift, 1]),
      }),
      201,
    );
    await w.refused(
      w.call('director', 'post', `/stock/adjustments/${request.id}/approve`, {}),
      403,
      'NOT_ADJUSTMENT_APPROVER',
    );
    await w.ok(w.call('general', 'post', `/stock/adjustments/${request.id}/approve`, {}));
  });
});

describe('read scope (FR-081)', () => {
  it('balances and movements follow the role; client users get 404 on every stock endpoint', async () => {
    const c = await supervised(10);
    const other = await w.extraAnimateur(c);
    const toOther = await w.transfer(c, 'supervisor', other.animateur, lines([gift, 4]));
    await w.confirm(other.auth, toOther, [[gift.id, 4]]);
    const holders = async (actor) =>
      (await w.ok(w.call(actor, 'get', `/campaigns/${c.id}/stock/balances`))).locations
        .map((row) => row.kind + (row.fullName ? ':' + row.userId : ''))
        .sort();
    const names = (...users) => users.map((user) => 'holder:' + user.id);
    expect((await holders('director')).sort()).toEqual(
      [
        'customers',
        'in_transit',
        'losses',
        'warehouse',
        ...names(w.people.supervisor, other.animateur),
      ].sort(),
    );
    expect(await holders('regional')).toEqual(
      ['in_transit', 'warehouse', ...names(w.people.supervisor, other.animateur)].sort(),
    );
    expect(await holders('supervisor')).toEqual(names(w.people.supervisor, other.animateur).sort());
    expect(await holders(other.auth)).toEqual(names(other.animateur));
    expect(await holders(c.animateurAuth)).toEqual([]);
    const movementsOf = async (actor) =>
      (await w.ok(w.call(actor, 'get', `/campaigns/${c.id}/stock/movements?pageSize=100`))).length;
    expect(await movementsOf('director')).toBe(3);
    expect(await movementsOf('supervisor')).toBe(2);
    expect(await movementsOf(other.auth)).toBe(1);
    expect(await movementsOf(c.animateurAuth)).toBe(0);
    const stranger = await w.call('regionalTwo', 'get', `/campaigns/${c.id}/stock/balances`);
    expect(stranger.status).toBe(404);
    for (const path of [
      `/campaigns/${c.id}/stock/balances`,
      `/campaigns/${c.id}/stock/movements`,
      `/campaigns/${c.id}/stock/reconciliation`,
      `/campaigns/${c.id}/stock/recipients?direction=down`,
      '/me/stock',
    ]) {
      expect((await w.call('clientUser', 'get', path)).status, path).toBe(404);
    }
    const movement = (
      await w.ok(w.call('director', 'get', `/campaigns/${c.id}/stock/movements`))
    )[0];
    expect((await w.call('clientUser', 'get', `/stock/movements/${movement.id}`)).status).toBe(404);
    expect((await w.call('supervisorTwo', 'get', `/stock/movements/${movement.id}`)).status).toBe(
      404,
    );
    expect((await w.call(c.animateurAuth, 'get', `/stock/movements/${movement.id}`)).status).toBe(
      404,
    );
  });

  it('/me/stock: balances, shipments to confirm, own pending shipments and approvals', async () => {
    const c = await supervised(10);
    const pending = await w.transfer(c, 'supervisor', c.animateur, lines([gift, 2]));
    const mineOf = (actor) => w.ok(w.call(actor, 'get', '/me/stock'));
    const supervisor = await mineOf('supervisor');
    expect(supervisor.outgoing.map(({ id }) => id)).toContain(pending.id);
    expect(supervisor.balances.find((b) => b.campaign.id === c.id).items[0]).toMatchObject({
      quantity: 8,
    });
    const animateur = await mineOf(c.animateurAuth);
    expect(animateur.awaitingConfirmation.map(({ id }) => id)).toEqual([pending.id]);
    expect(animateur.approvals).toEqual({ adjustments: [], disputes: [] });
    const request = await w.ok(
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/adjustments`, {
        reason: 'damaged',
        note: 'Wet',
        lines: lines([gift, 1]),
      }),
      201,
    );
    expect((await mineOf('regional')).approvals.adjustments.map(({ id }) => id)).toContain(
      request.id,
    );
    expect((await mineOf('supervisor')).approvals.adjustments).toEqual([]);
  });
});

describe('reconciliation (FR-083)', () => {
  it('explains every unit: the check passes per holder and the totals add up', async () => {
    const c = await supervised(30);
    const animateurTransfer = await w.transfer(c, 'supervisor', c.animateur, lines([gift, 10]));
    await w.confirm(c.animateurAuth, animateurTransfer, [[gift.id, 9]]);
    await w.ok(
      w.call('director', 'post', `/stock/transfers/${animateurTransfer.id}/resolve`, {
        lines: [{ stockItemId: gift.id, decision: 'return_to_sender' }],
      }),
    );
    const report = await w.ok(w.call('director', 'get', `/campaigns/${c.id}/stock/reconciliation`));
    expect(report.ok).toBe(true);
    const row = (user) => report.rows.find((entry) => entry.holder.userId === user?.id);
    expect(row(w.people.supervisor)).toMatchObject({
      received: 30,
      sent: 9,
      balance: 21,
      check: { ok: true },
    });
    expect(row(c.animateur)).toMatchObject({ received: 9, balance: 9, check: { ok: true } });
    expect(report.totals.all).toMatchObject({ stockIn: 30, physical: 30, losses: 0, customers: 0 });
    const regional = await w.ok(
      w.call('regional', 'get', `/campaigns/${c.id}/stock/reconciliation`),
    );
    expect(regional.totals).toBeNull();
    expect(regional.rows.every((entry) => entry.check.ok)).toBe(true);
  });
});
