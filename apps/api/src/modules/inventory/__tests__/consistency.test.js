import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { buildUserActor } from '../../../core/auth/actor.js';
import { cleanupIdempotencyKeys } from '../../../core/http/idempotency.js';
import { AppError } from '../../../core/errors/index.js';
import { prisma } from '../../../db/client.js';
import { withTransaction } from '../../../db/transaction.js';
import * as reports from '../inventory.reports.js';
import * as service from '../inventory.service.js';
import { createStockWorld } from './helpers.js';

const app = createApp();
let w;
let gift;
let sample;

beforeAll(async () => {
  w = await createStockWorld(app);
  gift = await w.gift({ name: 'Mug' });
  sample = await w.sample({ name: 'Sachet' });
});
afterEach(() => vi.restoreAllMocks());

const lines = (...pairs) => pairs.map(([item, quantity]) => ({ stockItemId: item.id, quantity }));
const run = (work) => withTransaction(work);
const movementCount = (campaignId) => prisma.stockMovement.count({ where: { campaignId } });
async function supervised(quantity = 20) {
  const c = await w.campaign();
  await w.stockIn(c, lines([gift, quantity]));
  const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, quantity]));
  await w.confirm('supervisor', transfer, [[gift.id, quantity]]);
  return c;
}

describe('idempotency (field-entry endpoints)', () => {
  const stockIn = (c, body, key, actor = 'director') =>
    w.call(actor, 'post', `/campaigns/${c.id}/stock/stock-in`, body, { key });

  it('replays the stored response without posting a second time', async () => {
    const c = await w.campaign();
    const key = randomUUID();
    const body = { reference: 'BL-1', lines: lines([gift, 5]) };
    const first = await stockIn(c, body, key);
    const second = await stockIn(c, body, key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await movementCount(c.id)).toBe(1);
    expect(await w.balance(c, 'warehouse', gift)).toBe(5);
  });

  it('IDEMPOTENCY_KEY_REUSED for a different body or another endpoint; REQUIRED when missing', async () => {
    const c = await w.campaign();
    const key = randomUUID();
    await w.ok(stockIn(c, { reference: 'BL-1', lines: lines([gift, 5]) }, key), 201);
    await w.refused(
      stockIn(c, { reference: 'BL-1', lines: lines([gift, 6]) }, key),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
    await w.refused(
      w.call(
        'director',
        'post',
        `/campaigns/${c.id}/stock/transfers`,
        { recipientUserId: w.people.supervisor.id, lines: lines([gift, 1]) },
        { key },
      ),
      422,
      'IDEMPOTENCY_KEY_REUSED',
    );
    const bare = w.call('director', 'post', `/campaigns/${c.id}/stock/stock-in`, {
      reference: 'x',
      lines: lines([gift, 1]),
    });
    await w.refused(bare.unset('Idempotency-Key'), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    await w.refused(
      stockIn(c, { reference: 'x', lines: lines([gift, 1]) }, 'not-a-uuid'),
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect(await movementCount(c.id)).toBe(1);
  });

  it('a double-clicked transfer creates one movement', async () => {
    const c = await supervised(10);
    const body = { recipientUserId: c.animateur.id, lines: lines([gift, 4]) };
    const key = randomUUID();
    const send = () =>
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/transfers`, body, { key });
    const [first, second] = await Promise.all([send(), send()]);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(
      await prisma.stockMovement.count({ where: { campaignId: c.id, type: 'transfer' } }),
    ).toBe(2);
    expect(await w.balance(c, 'holder', gift, w.people.supervisor)).toBe(6);
  });

  it('a refused request leaves no key behind, so the same key can be retried', async () => {
    const c = await w.campaign();
    const key = randomUUID();
    const body = { recipientUserId: w.people.supervisor.id, lines: lines([gift, 3]) };
    const send = () =>
      w.call('director', 'post', `/campaigns/${c.id}/stock/transfers`, body, { key });
    await w.refused(send(), 422, 'INSUFFICIENT_STOCK');
    await w.stockIn(c, lines([gift, 3]));
    await w.ok(send(), 201);
    expect(await w.balance(c, 'in_transit', gift)).toBe(3);
  });

  it('keys live 48 hours: after that the key is free again and the cleanup job removes it', async () => {
    const c = await w.campaign();
    const key = randomUUID();
    await w.ok(stockIn(c, { reference: 'BL-1', lines: lines([gift, 1]) }, key), 201);
    const stored = await prisma.idempotencyKey.findFirstOrThrow({ where: { key } });
    const hours = (stored.expiresAt.getTime() - stored.createdAt.getTime()) / 3_600_000;
    expect(Math.round(hours)).toBe(48);
    const expire = () =>
      prisma.idempotencyKey.updateMany({
        where: { key },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    await expire();
    await w.ok(stockIn(c, { reference: 'BL-2', lines: lines([gift, 2]) }, key), 201);
    await expire();
    await cleanupIdempotencyKeys();
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(0);
  });
});

describe('concurrency (row locks, BR-41)', () => {
  it('two simultaneous transfers draining the same balance: one wins, one INSUFFICIENT_STOCK', async () => {
    const c = await supervised(10);
    const send = () =>
      w.call('supervisor', 'post', `/campaigns/${c.id}/stock/transfers`, {
        recipientUserId: c.animateur.id,
        lines: lines([gift, 10]),
      });
    const results = await Promise.all([send(), send()]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 422]);
    expect(results.find(({ status }) => status === 422).body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(await w.balance(c, 'holder', gift, w.people.supervisor)).toBe(0);
    expect(await w.balance(c, 'in_transit', gift)).toBe(10);
  });

  it('confirm and cancel racing on one transfer: exactly one wins', async () => {
    for (let round = 0; round < 3; round++) {
      const c = await w.campaign();
      await w.stockIn(c, lines([gift, 10]));
      const transfer = await w.transfer(c, 'director', w.people.supervisor, lines([gift, 10]));
      const [confirm, cancel] = await Promise.all([
        w.call('supervisor', 'post', `/stock/transfers/${transfer.id}/confirm`, {
          lines: [{ stockItemId: gift.id, quantityReceived: 10 }],
        }),
        w.call('director', 'post', `/stock/transfers/${transfer.id}/cancel`, {}),
      ]);
      expect([confirm.status, cancel.status].sort()).toEqual([200, 422]);
      const loser = confirm.status === 422 ? confirm : cancel;
      expect(loser.body.error.code).toBe('TRANSFER_NOT_PENDING');
      expect(await w.balance(c, 'in_transit', gift)).toBe(0);
      expect(await w.sumOfBalances(c, gift)).toBe(0);
      expect(
        (await w.balance(c, 'warehouse', gift)) +
          (await w.balance(c, 'holder', gift, w.people.supervisor)),
      ).toBe(10);
    }
  });

  it('50 parallel mixed operations: no deadlock, no lost update, ledger still balanced', async () => {
    const c = await supervised(100);
    const [two] = [await w.extraAnimateur(c)];
    const sv = w.actor('supervisor');
    const director = w.actor('director');
    const pending = [];
    for (let index = 0; index < 10; index++) {
      pending.push(await w.transfer(c, 'supervisor', c.animateur, lines([gift, 2])));
    }
    const operations = [];
    for (let index = 0; index < 50; index++) {
      const kind = index % 5;
      if (kind === 0)
        operations.push(() =>
          run((tx) =>
            service.stockIn(tx, director, c.id, { reference: 'P', lines: lines([gift, 3]) }),
          ),
        );
      if (kind === 1)
        operations.push(() =>
          run((tx) =>
            service.transfer(tx, sv, c.id, {
              recipientUserId: (index % 2 ? two.animateur : c.animateur).id,
              lines: lines([gift, 3]),
            }),
          ),
        );
      if (kind === 2)
        operations.push(() =>
          run((tx) =>
            service.confirm(tx, buildUserActor(c.animateur), pending[index % 10].id, {
              lines: [{ stockItemId: gift.id, quantityReceived: index % 3 ? 2 : 1 }],
            }),
          ),
        );
      if (kind === 3)
        operations.push(() => run((tx) => service.cancel(tx, sv, pending[(index + 1) % 10].id)));
      if (kind === 4)
        operations.push(() =>
          run((tx) =>
            service.requestAdjustment(tx, sv, c.id, {
              reason: 'damaged',
              note: 'Broken',
              lines: lines([gift, 1]),
            }),
          ),
        );
    }
    const settled = await Promise.allSettled(operations.map((operation) => operation()));
    const allowed = new Set(['INSUFFICIENT_STOCK', 'TRANSFER_NOT_PENDING']);
    for (const result of settled) {
      if (result.status === 'rejected') {
        expect(result.reason, String(result.reason)).toBeInstanceOf(AppError);
        expect(allowed.has(result.reason.code), result.reason.code).toBe(true);
      }
    }
    expect(settled.filter(({ status }) => status === 'fulfilled').length).toBeGreaterThan(25);
    expect(await w.sumOfBalances(c, gift)).toBe(0);
    const report = await reports.reconciliation(director, c.id);
    expect(report.ok).toBe(true);
  });
});

describe('invariants over a random sequence of 200 valid operations', () => {
  it('every unit sits in exactly one place, balances never go negative, reconciliation passes', async () => {
    const c = await w.campaign();
    const second = await w.extraAnimateur(c);
    const people = {
      director: w.actor('director'),
      general: w.actor('general'),
      regional: w.actor('regional'),
      supervisor: w.actor('supervisor'),
      one: buildUserActor(c.animateur),
      two: second.actor,
    };
    const byId = new Map(Object.values(people).map((actor) => [actor.id, actor]));
    const items = [gift, sample];
    let seed = 20_261_120;
    const rng = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = (array) => array[Math.floor(rng() * array.length)];
    const between = (low, high) => low + Math.floor(rng() * (high - low + 1));

    const holdings = async () => {
      const rows = await prisma.stockBalance.findMany({
        where: { location: { campaignId: c.id }, quantity: { gt: 0 } },
        include: { location: true },
      });
      return rows
        .filter(({ locationKind }) => ['warehouse', 'holder'].includes(locationKind))
        .map((row) => ({
          owner: row.location.userId ?? 'warehouse',
          item: row.stockItemId,
          quantity: row.quantity,
        }));
    };
    const withBalance = (rows, owners) => rows.filter((row) => owners.includes(row.owner));
    const asActor = (owner) => (owner === 'warehouse' ? people.director : byId.get(owner));
    const open = (where) =>
      prisma.stockMovement.findMany({
        where: { campaignId: c.id, ...where },
        include: { lines: true, fromLocation: true, toLocation: true },
      });

    const operations = {
      async stockIn() {
        const item = pick(items);
        await run((tx) =>
          service.stockIn(tx, people.director, c.id, {
            reference: 'R',
            lines: lines([item, between(1, 60)]),
          }),
        );
      },
      async transfer() {
        const rows = await holdings();
        const chain = {
          warehouse: [people.regional, people.supervisor],
          [people.regional.id]: [people.supervisor],
          [people.supervisor.id]: [people.one, people.two],
        };
        const candidates = rows.filter((row) => chain[row.owner]);
        if (!candidates.length) return false;
        const from = pick(candidates);
        await run((tx) =>
          service.transfer(tx, asActor(from.owner), c.id, {
            recipientUserId: pick(chain[from.owner]).id,
            lines: [{ stockItemId: from.item, quantity: between(1, from.quantity) }],
          }),
        );
      },
      async confirm() {
        const movements = await open({ status: 'pending', type: { in: ['transfer', 'return'] } });
        if (!movements.length) return false;
        const movement = pick(movements);
        const recipient = asActor(movement.toLocation.userId ?? 'warehouse');
        await run((tx) =>
          service.confirm(tx, recipient, movement.id, {
            lines: movement.lines.map((line) => ({
              stockItemId: line.stockItemId,
              quantityReceived: rng() < 0.65 ? line.quantity : between(0, line.quantity),
            })),
          }),
        );
      },
      async cancel() {
        const movements = await open({ status: 'pending', type: { in: ['transfer', 'return'] } });
        if (!movements.length) return false;
        const movement = pick(movements);
        await run((tx) => service.cancel(tx, byId.get(movement.createdById), movement.id));
      },
      async giveBack() {
        const rows = await holdings();
        const row = pick(
          withBalance(rows, [
            people.supervisor.id,
            people.regional.id,
            people.one.id,
            people.two.id,
          ]),
        );
        if (!row) return false;
        const actor = byId.get(row.owner);
        const body =
          actor.id === people.regional.id
            ? { destination: 'warehouse' }
            : actor.role === 'supervisor'
              ? pick([
                  { destination: 'warehouse' },
                  { destination: 'user', recipientUserId: people.regional.id },
                ])
              : { destination: 'user', recipientUserId: people.supervisor.id };
        await run((tx) =>
          service.giveBack(tx, actor, c.id, {
            ...body,
            lines: [{ stockItemId: row.item, quantity: between(1, row.quantity) }],
          }),
        );
      },
      async adjust() {
        const rows = await holdings();
        const row = pick(rows.filter(({ owner }) => owner !== 'warehouse'));
        if (!row) return false;
        await run((tx) =>
          service.requestAdjustment(tx, people.director, c.id, {
            holderUserId: row.owner,
            reason: pick(['damaged', 'count_correction']),
            note: 'Counted again',
            lines: [{ stockItemId: row.item, quantity: between(1, Math.min(3, row.quantity)) }],
          }),
        );
      },
      async decide() {
        const movements = await open({ status: 'pending_approval' });
        if (!movements.length) return false;
        const movement = pick(movements);
        const holder = (
          await prisma.stockBalance.findFirst({
            where: {
              locationId: movement.fromLocationId,
              stockItemId: movement.lines[0].stockItemId,
            },
          })
        )?.quantity;
        const enough = movement.lines.every((line) => holder >= line.quantity);
        const approve = enough && rng() < 0.8;
        await run((tx) =>
          service.decideAdjustment(
            tx,
            people.general,
            movement.id,
            approve ? 'approve' : 'reject',
            { note: 'Decided' },
          ),
        );
      },
      async resolve() {
        const movements = await open({ status: 'disputed', resolvedBy: { none: {} } });
        if (!movements.length) return false;
        const movement = pick(movements);
        const short = movement.lines.filter((line) => line.quantity > (line.quantityReceived ?? 0));
        await run((tx) =>
          service.resolveDispute(tx, people.general, movement.id, {
            lines: short.map((line) => ({
              stockItemId: line.stockItemId,
              decision: pick(['loss', 'return_to_sender']),
            })),
            note: 'Settled',
          }),
        );
      },
      async distribute() {
        const rows = await holdings();
        const row = pick(withBalance(rows, [people.one.id]));
        if (!row) return false;
        const entitlement = await w.entitlement(c, { id: row.item }, between(1, row.quantity));
        const result = await run((tx) =>
          service.distribute(tx, { actor: people.one, giftEntitlementId: entitlement.id }),
        );
        expect(result.ok).toBe(true);
      },
    };
    const weights = [
      ['stockIn', 3],
      ['transfer', 5],
      ['confirm', 5],
      ['cancel', 1],
      ['giveBack', 2],
      ['adjust', 1],
      ['decide', 1],
      ['resolve', 1],
      ['distribute', 2],
    ].flatMap(([name, weight]) => Array(weight).fill(name));

    let done = 0;
    let attempts = 0;
    while (done < 200 && attempts < 1500) {
      attempts += 1;
      if ((await operations[pick(weights)]()) !== false) done += 1;
    }
    expect(done).toBe(200);

    for (const item of items) {
      expect(await w.sumOfBalances(c, item), 'sum over all locations').toBe(0);
    }
    const negative = await prisma.stockBalance.count({
      where: {
        location: { campaignId: c.id, kind: { in: ['warehouse', 'holder', 'in_transit'] } },
        quantity: { lt: 0 },
      },
    });
    expect(negative).toBe(0);
    const unbalanced = await prisma.$queryRaw`
      SELECT movement_line_id FROM stock_ledger_entries WHERE campaign_id = ${c.id}::uuid
      GROUP BY movement_line_id HAVING SUM(quantity_delta) <> 0`;
    expect(unbalanced).toEqual([]);
    const report = await reports.reconciliation(people.director, c.id);
    expect(report.rows.filter((row) => !row.check.ok)).toEqual([]);
    expect(report.ok).toBe(true);
    const distributed = await prisma.giftEntitlement.aggregate({
      where: { campaignId: c.id, status: 'distributed' },
      _sum: { quantity: true },
    });
    expect(report.totals.all.customers).toBe(distributed._sum.quantity ?? 0);
  }, 240_000);
});

describe('distribution service (BR-32, E-02)', () => {
  const asOne = (c) => buildUserActor(c.animateur);
  async function holding(quantity) {
    const c = await supervised(20);
    if (quantity) {
      const transfer = await w.transfer(c, 'supervisor', c.animateur, lines([gift, quantity]));
      await w.confirm(c.animateurAuth, transfer, [[gift.id, quantity]]);
    }
    return c;
  }

  it('refuses without a balance and leaves nothing behind; works after the stock arrives', async () => {
    const c = await holding(1);
    const entitlement = await w.entitlement(c, gift, 3);
    const refused = await run((tx) =>
      service.distribute(tx, { actor: asOne(c), giftEntitlementId: entitlement.id }),
    );
    expect(refused).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_STOCK',
      details: { available: 1, requested: 3, stockItemId: gift.id },
    });
    expect(await prisma.stockMovement.count({ where: { giftEntitlementId: entitlement.id } })).toBe(
      0,
    );
    await prisma.giftEntitlement.update({
      where: { id: entitlement.id },
      data: { status: 'undelivered' },
    });
    const more = await w.transfer(c, 'supervisor', c.animateur, lines([gift, 2]));
    await w.confirm(c.animateurAuth, more, [[gift.id, 2]]);
    const done = await run((tx) =>
      service.distribute(tx, { actor: asOne(c), giftEntitlementId: entitlement.id }),
    );
    expect(done.ok).toBe(true);
    expect(await w.balance(c, 'holder', gift, c.animateur)).toBe(0);
    expect(await w.balance(c, 'customers', gift)).toBe(3);
  });

  it('a second distribution of the same entitlement is refused, by the service and by the unique index', async () => {
    const c = await holding(5);
    const entitlement = await w.entitlement(c, gift, 1);
    await run((tx) =>
      service.distribute(tx, { actor: asOne(c), giftEntitlementId: entitlement.id }),
    );
    await expect(
      run((tx) => service.distribute(tx, { actor: asOne(c), giftEntitlementId: entitlement.id })),
    ).rejects.toMatchObject({ status: 409, code: 'ENTITLEMENT_NOT_DISTRIBUTABLE' });
    const existing = await prisma.stockMovement.findFirstOrThrow({
      where: { giftEntitlementId: entitlement.id },
    });
    await expect(
      prisma.stockMovement.create({
        data: {
          agencyId: existing.agencyId,
          campaignId: existing.campaignId,
          type: 'distribution',
          status: 'posted',
          fromLocationId: existing.fromLocationId,
          toLocationId: existing.toLocationId,
          giftEntitlementId: entitlement.id,
          createdById: c.animateur.id,
        },
      }),
    ).rejects.toThrow();
    expect(await w.balance(c, 'holder', gift, c.animateur)).toBe(4);
  });

  it('only the Animateur who made the sale distributes from their own balance', async () => {
    const c = await holding(5);
    const entitlement = await w.entitlement(c, gift, 1);
    const other = await w.extraAnimateur(c);
    await expect(
      run((tx) =>
        service.distribute(tx, { actor: other.actor, giftEntitlementId: entitlement.id }),
      ),
    ).rejects.toMatchObject({ status: 422, code: 'ENTITLEMENT_NOT_DISTRIBUTABLE' });
  });
});
