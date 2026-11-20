import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { buildUserActor } from '../../../core/auth/actor.js';
import { prisma } from '../../../db/client.js';
import { createStockWorld, PDF } from './helpers.js';

const app = createApp();
let w;
let gift;
let sample;

beforeAll(async () => {
  w = await createStockWorld(app);
  gift = await w.gift({ name: 'Mug' });
  sample = await w.sample({ name: 'Sachet' });
});

const lines = (...pairs) => pairs.map(([item, quantity]) => ({ stockItemId: item.id, quantity }));

describe('posting table (design §"how each movement is written")', () => {
  it('stock-in: external −q, warehouse +q, posted', async () => {
    const c = await w.campaign({ status: 'planning' });
    const movement = await w.stockIn(c, lines([gift, 200]));
    expect(movement).toMatchObject({ type: 'stock_in', status: 'posted' });
    expect(await w.ledger(movement.id)).toEqual(['external=-200', 'warehouse=200']);
    expect(await w.balance(c, 'warehouse', gift)).toBe(200);
    expect(await w.balance(c, 'external', gift)).toBe(-200);
  });

  it('transfer → confirm in full: sender −q, in transit +q, then in transit −q, recipient +q', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 100]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 100]));
    expect(transfer.status).toBe('pending');
    expect(await w.ledger(transfer.id)).toEqual(['warehouse=-100', 'in_transit=100']);
    expect(await w.balance(c, 'in_transit', gift)).toBe(100);
    const confirmed = await w.confirm('supervisor', transfer, [[gift.id, 100]]);
    expect(confirmed.status).toBe('confirmed');
    expect(await w.ledger(transfer.id)).toEqual([
      'warehouse=-100',
      'in_transit=100',
      'in_transit=-100',
      'holder:supervisor=100',
    ]);
    expect(await w.balance(c, 'holder', gift, w.people.supervisor)).toBe(100);
    expect(await w.balance(c, 'in_transit', gift)).toBe(0);
  });

  it('E-09: 100 sent, 95 received ⇒ disputed, the 5 stay in transit (BR-42)', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 100]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 100]));
    const disputed = await w.confirm('supervisor', transfer, [[gift.id, 95]]);
    expect(disputed).toMatchObject({
      status: 'disputed',
      lines: [{ quantity: 100, quantityReceived: 95 }],
    });
    expect(await w.balance(c, 'in_transit', gift)).toBe(5);
    expect(await w.balance(c, 'holder', gift, w.people.supervisor)).toBe(95);
  });

  it('cancel while pending: in transit −q, sender +q', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 30]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 30]));
    const cancelled = await w.ok(
      w.call('director', 'post', `/stock/transfers/${transfer.id}/cancel`, {}),
    );
    expect(cancelled.status).toBe('cancelled');
    expect(await w.ledger(transfer.id)).toEqual([
      'warehouse=-30',
      'in_transit=30',
      'in_transit=-30',
      'warehouse=30',
    ]);
    expect(await w.balance(c, 'warehouse', gift)).toBe(30);
  });

  it('return up follows the transfer cycle; return to client is posted at once', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 50]));
    const down = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 50]));
    await w.confirm('supervisor', down, [[gift.id, 50]]);
    const back = await w.ok(
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/returns`, {
        destination: 'warehouse',
        lines: lines([gift, 20]),
      }),
      201,
    );
    expect(back).toMatchObject({ type: 'return', status: 'pending' });
    expect(await w.ledger(back.id)).toEqual(['holder:supervisor=-20', 'in_transit=20']);
    expect((await w.confirm('director', back, [[gift.id, 20]])).status).toBe('confirmed');
    expect(await w.balance(c, 'warehouse', gift)).toBe(20);
    const toClient = await w.ok(
      w.call('director', 'post', `/campaigns/${c.id}/stock/returns`, {
        destination: 'client',
        reference: 'RET-1',
        lines: lines([gift, 20]),
      }),
      201,
    );
    expect(toClient.status).toBe('posted');
    expect(await w.ledger(toClient.id)).toEqual(['warehouse=-20', 'external=20']);
  });

  it('dispute resolution: one adjustment, per line back to the sender or to losses', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 100], [sample, 100]));
    const transfer = await w.transfer(
      c,
      'director',
      w.people.supervisor,
      lines([gift, 100], [sample, 100]),
    );
    await w.confirm('supervisor', transfer, [
      [gift.id, 95],
      [sample.id, 90],
    ]);
    const resolution = await w.ok(
      w.call('regional', 'post', `/stock/transfers/${transfer.id}/resolve`, {
        lines: [
          { stockItemId: gift.id, decision: 'loss' },
          { stockItemId: sample.id, decision: 'return_to_sender' },
        ],
        note: 'Box damaged in transit',
      }),
    );
    expect(resolution).toMatchObject({
      type: 'adjustment',
      status: 'posted',
      resolvesMovementId: transfer.id,
    });
    expect(await w.balance(c, 'losses', gift)).toBe(5);
    expect(await w.balance(c, 'warehouse', sample)).toBe(10);
    expect(await w.balance(c, 'in_transit', gift)).toBe(0);
    await w.refused(
      w.call('director', 'post', `/stock/transfers/${transfer.id}/resolve`, {
        lines: [
          { stockItemId: gift.id, decision: 'return_to_sender' },
          { stockItemId: sample.id, decision: 'return_to_sender' },
        ],
      }),
      409,
      'DISPUTE_ALREADY_RESOLVED',
    );
  });

  it('adjustment: nothing posted until approved, then holder −q, losses +q', async () => {
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 40]));
    const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 40]));
    await w.confirm('supervisor', transfer, [[gift.id, 40]]);
    const requested = await w.ok(
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/adjustments`, {
        reason: 'damaged',
        note: 'Water damage',
        lines: lines([gift, 4]),
      }),
      201,
    );
    expect(requested.status).toBe('pending_approval');
    expect(await w.ledger(requested.id)).toEqual([]);
    const approved = await w.ok(
      w.call('regional', 'post', `/stock/adjustments/${requested.id}/approve`, {}),
    );
    expect(approved.status).toBe('posted');
    expect(await w.ledger(approved.id)).toEqual(['holder:supervisor=-4', 'losses=4']);
    const second = await w.ok(
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/adjustments`, {
        reason: 'count_correction',
        note: 'Recount',
        lines: lines([gift, 1]),
      }),
      201,
    );
    const rejected = await w.ok(
      w.call('director', 'post', `/stock/adjustments/${second.id}/reject`, {
        note: 'Recount again',
      }),
    );
    expect(rejected.status).toBe('rejected');
    expect(await w.ledger(rejected.id)).toEqual([]);
    expect(await w.balance(c, 'holder', gift, w.people.supervisor)).toBe(36);
    const detail = await w.ok(w.call('director', 'get', `/stock/movements/${second.id}`));
    expect(detail).toMatchObject({ reason: 'count_correction', decisionNote: 'Recount again' });
  });

  it('BR-32: distribution takes the units from the Animateur and marks the entitlement', async () => {
    const { distribute } = await import('../inventory.service.js');
    const { withTransaction } = await import('../../../db/transaction.js');
    const c = await w.campaign();
    await w.stockIn(c, lines([gift, 10]));
    const sv = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 10]));
    await w.confirm('supervisor', sv, [[gift.id, 10]]);
    const down = await w.transfer(c, 'supervisor', c.animateur, lines([gift, 3]));
    await w.confirm(c.animateurAuth, down, [[gift.id, 3]]);
    const entitlement = await w.entitlement(c, gift, 2);
    const result = await withTransaction((tx) =>
      distribute(tx, { actor: buildUserActor(c.animateur), giftEntitlementId: entitlement.id }),
    );
    expect(result.ok).toBe(true);
    expect(await w.ledger(result.movementId)).toEqual(['holder:animateur=-2', 'customers=2']);
    expect(await w.balance(c, 'holder', gift, c.animateur)).toBe(1);
    expect(
      (await prisma.giftEntitlement.findUnique({ where: { id: entitlement.id } })).status,
    ).toBe('distributed');
  });
});

describe('documents', () => {
  it('stock-in stores an optional proof file readable by inventory readers only', async () => {
    const c = await w.campaign();
    const movement = await w.ok(
      w.call(
        'director',
        'post',
        `/campaigns/${c.id}/stock/stock-in`,
        { reference: 'BL-77', lines: lines([gift, 5]) },
        {
          attach: { buffer: PDF, options: { filename: 'bl.pdf', contentType: 'application/pdf' } },
        },
      ),
      201,
    );
    expect(movement.proofFileId).toBeTruthy();
    expect((await w.call('director', 'get', `/files/${movement.proofFileId}`)).status).toBe(200);
    expect((await w.call('clientUser', 'get', `/files/${movement.proofFileId}`)).status).toBe(404);
  });
});

describe('acceptance scenario (prompt 10 §12)', () => {
  it('200 in, 100 to the supervisor, 95 confirmed, 5 written off, 40 on to an Animateur', async () => {
    const c = await w.campaign({ status: 'assigned' });
    await w.stockIn(c, lines([gift, 200]));
    const first = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 100]));
    expect((await w.confirm('supervisor', first, [[gift.id, 95]])).status).toBe('disputed');
    await w.ok(
      w.call('regional', 'post', `/stock/transfers/${first.id}/resolve`, {
        lines: [{ stockItemId: gift.id, decision: 'loss' }],
        note: 'Five units lost on the road',
      }),
    );
    const second = await w.transfer(c, 'supervisor', c.animateur, lines([gift, 40]));

    const matrix = await w.ok(w.call('director', 'get', `/campaigns/${c.id}/stock/balances`));
    const quantity = (match) => matrix.locations.find(match).quantities[gift.id] ?? 0;
    expect(quantity((row) => row.kind === 'warehouse')).toBe(100);
    expect(quantity((row) => row.userId === w.people.supervisor.id)).toBe(55);
    expect(quantity((row) => row.kind === 'in_transit')).toBe(40);
    expect(quantity((row) => row.kind === 'losses')).toBe(5);
    expect(matrix.totals.quantities[gift.id]).toBe(200);

    await w.confirm(c.animateurAuth, second, [[gift.id, 40]]);
    const report = await w.ok(w.call('director', 'get', `/campaigns/${c.id}/stock/reconciliation`));
    expect(report.ok).toBe(true);
    expect(report.totals.all).toMatchObject({ stockIn: 200, physical: 195, losses: 5 });
    expect(await w.balance(c, 'holder', gift, c.animateur)).toBe(40);

    await prisma.campaign.update({ where: { id: c.id }, data: { status: 'completed' } });
    const closing = await w.call('director', 'post', `/campaigns/${c.id}/close`, {});
    expect(closing.status).toBe(422);
    expect(JSON.stringify(closing.body.error.details)).toContain('PHYSICAL_STOCK_REMAINING');
  });
});
