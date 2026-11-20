import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, login } from '../../../../test/helpers/auth.js';
import { createApp } from '../../../app.js';
import { clock } from '../../../core/time/clock.js';
import { prisma } from '../../../db/client.js';
import { createStockItem } from '../../../db/__tests__/factories.js';
import { createStockWorld, PDF } from '../../inventory/__tests__/helpers.js';
import { closeExpired } from '../tombola.service.js';

let world;
beforeAll(async () => {
  world = await createStockWorld(createApp());
});

async function setup({ promotion = true, maxPerCustomer = null, entries = true } = {}) {
  const context = await world.campaign();
  const agencyId = world.agency.id;
  const rule = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: context.id } });
  await prisma.campaignRule.create({
    data: {
      agencyId,
      ruleSetId: rule.id,
      ruleType: 'customer_fields',
      config: { fullName: 'optional', phone: 'optional', consentRequired: false },
    },
  });
  const gift = promotion && (await createStockItem(agencyId, world.client.id));
  if (gift)
    await prisma.promotion.create({
      data: {
        agencyId,
        ruleSetId: rule.id,
        name: 'Tiered gift',
        type: 'tiered_gift',
        maxPerCustomer,
        tiers: {
          create: [1, 2, 3].map((quantity) => ({
            agencyId,
            productId: context.product.id,
            stockItemId: gift.id,
            minQuantity: quantity,
            giftQuantity: quantity,
          })),
        },
      },
    });
  const tombola =
    entries &&
    (await prisma.tombola.create({
      data: {
        agencyId,
        campaignId: context.id,
        name: 'Test Tombola',
        entryBasis: 'per_sale',
        entriesPerBasis: 1,
        requiresPurchase: true,
        registrationEndsAt: new Date(Date.now() + 3_600_000),
        drawScheduledAt: new Date(Date.now() + 7_200_000),
        winnersCount: 1,
        reservesCount: 0,
      },
    }));
  const post = (customer, quantity = 3, options) =>
    world.call(
      context.animateurAuth,
      'post',
      `/assignments/${context.assignment.id}/sales`,
      { items: [{ productId: context.product.id, quantity }], customer },
      options,
    );
  return { ...context, gift, rule, tombola, post };
}
const customer = { fullName: 'Karim Benali', phone: '0550123456', consentTombola: true };
const sale = (context, buyer, quantity = 3, options) =>
  world.ok(context.post(buyer, quantity, options), 201);
const get = (actor, path) => world.ok(world.call(actor, 'get', path));

async function restock(context, quantity) {
  const lines = [{ stockItemId: context.gift.id, quantity }];
  await world.stockIn(context, lines);
  const regional = await world.transfer(context, 'director', world.people.regional, lines);
  await world.confirm('regional', regional, [[context.gift.id, quantity]]);
  const supervisor = await world.transfer(context, 'regional', world.people.supervisor, lines);
  await world.confirm('supervisor', supervisor, [[context.gift.id, quantity]]);
  const holder = await world.transfer(context, 'supervisor', context.animateur, lines);
  await world.confirm(context.animateurAuth, holder, [[context.gift.id, quantity]]);
}

describe('Prompt 12 sales', () => {
  it('uses the highest tier, records movement and numbers, and replays the exact response', async () => {
    const context = await setup({ maxPerCustomer: 1 });
    await restock(context, 8);
    const key = randomUUID();
    const result = await sale(context, customer, 3, { key });
    expect(result).toMatchObject({
      units: 3,
      ruleSetId: context.rule.id,
      customer: {
        fullName: 'K. B.',
        phone: '+213 5•• •• •• 56',
        existing: false,
      },
    });
    expect(result.entitlements[0]).toMatchObject({ quantity: 3, status: 'distributed' });
    expect(result.tombolaEntries[0].numbers).toEqual([1]);
    const retry = await context.post(customer, 3, { key });
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data).toEqual(result);
    expect(await world.balance(context, 'holder', context.gift, context.animateur)).toBe(5);
    const again = await sale(context, {
      ...customer,
      fullName: 'Changed Name',
      phone: '+213550123456',
    });
    expect(again.customer).toMatchObject({
      id: result.customer.id,
      fullName: 'K. B.',
      existing: true,
    });
    expect(again.skippedPromotions[0].code).toBe('CUSTOMER_LIMIT_REACHED');
    await world.refused(world.call('clientUser', 'get', '/sales/' + result.id), 404, 'NOT_FOUND');
    await world.refused(
      world.call('clientUser', 'get', `/campaigns/${context.id}/customers`),
      404,
      'NOT_FOUND',
    );
    expect((await get('general', '/customers/' + result.customer.id)).fullName).toBe(
      'Karim Benali',
    );
    expect(
      await prisma.auditLog.count({
        where: { entityId: result.customer.id, action: 'customer.personal_data_read' },
      }),
    ).toBe(1);
    const voided = await world.ok(
      world.call('supervisor', 'post', `/sales/${result.id}/void`, { reason: 'Incorrect sale' }),
    );
    expect(voided.entitlements[0].status).toBe('distributed');
    expect(voided.tombolaEntries[0]).toMatchObject({
      status: 'excluded',
      excludedReason: 'sale_voided',
    });
    expect((await get('supervisor', `/campaigns/${context.id}/sales/review`))[0].id).toBe(
      result.id,
    );
    expect((await get('director', `/campaigns/${context.id}/stock/reconciliation`)).ok).toBe(true);
  });

  it('links concurrent shortages once and comments only after the last linked delivery', async () => {
    const context = await setup({ entries: false });
    const [first, second] = await Promise.all([
      sale(context, undefined, 1),
      sale(context, undefined, 1),
    ]);
    const giftIds = [first, second].map((row) => row.entitlements[0].id);
    const issueId = first.entitlements[0].shortageIssueId;
    expect(issueId).toBeTruthy();
    expect(second.entitlements[0].shortageIssueId).toBe(issueId);
    await expect(
      prisma.giftEntitlement.update({
        where: { id: giftIds[0] },
        data: { shortageIssueId: null },
      }),
    ).rejects.toThrow('The original shortage issue link cannot change');
    expect(
      await prisma.issue.count({
        where: { assignmentId: context.assignment.id, stockItemId: context.gift.id },
      }),
    ).toBe(1);
    await prisma.campaign.update({ where: { id: context.id }, data: { status: 'suspended' } });
    await world.refused(
      world.call(context.animateurAuth, 'post', `/entitlements/${giftIds[0]}/deliver`, {}),
      422,
      'ENTITLEMENT_NOT_DISTRIBUTABLE',
    );
    await prisma.campaign.update({ where: { id: context.id }, data: { status: 'active' } });
    await restock(context, 2);
    const deliver = (id) =>
      world.ok(world.call(context.animateurAuth, 'post', `/entitlements/${id}/deliver`, {}));
    await deliver(giftIds[0]);
    expect(await prisma.issueComment.count({ where: { issueId } })).toBe(0);
    await deliver(giftIds[1]);
    expect(await prisma.issueComment.count({ where: { issueId } })).toBe(1);
    expect((await prisma.issue.findUnique({ where: { id: issueId } })).status).toBe('open');
    await prisma.issue.update({
      where: { id: issueId },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedById: world.people.supervisor.id,
      },
    });
    const third = await sale(context, undefined, 1);
    expect(third.entitlements[0].shortageIssueId).not.toBe(issueId);
    const voided = await world.ok(
      world.call('supervisor', 'post', `/sales/${third.id}/void`, { reason: 'Wrong product' }),
    );
    expect(voided.entitlements[0].status).toBe('cancelled');
  });

  it(
    'BR-50: numbers 30 concurrent sales with distinct buyers contiguously',
    { timeout: 30_000 },
    async () => {
      const context = await setup({ promotion: false });
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          sale(context, { ...customer, phone: '05501234' + String(index).padStart(2, '0') }, 1),
        ),
      );
      expect(new Set(results.map(({ customer: row }) => row.id)).size).toBe(30);
      expect(results.flatMap((row) => row.tombolaEntries[0].numbers).sort((a, b) => a - b)).toEqual(
        Array.from({ length: 30 }, (_, index) => index + 1),
      );
    },
  );

  it('BR-34: normalizes concurrent first sales to a single customer', async () => {
    const context = await setup({ promotion: false });
    const [first, second] = await Promise.all([
      sale(context, customer, 1),
      sale(context, { ...customer, phone: '00213550123456' }, 1),
    ]);
    expect(first.customer.id).toBe(second.customer.id);
    expect([first.customer.existing, second.customer.existing].sort()).toEqual([false, true]);
  });

  it('E-07: counts prior-day entitlements toward a customer limit', async () => {
    const context = await setup({ entries: false, maxPerCustomer: 1 });
    const first = await sale(context, customer, 1);
    const frozen = vi
      .spyOn(clock, 'now')
      .mockReturnValue(new Date(+new Date(first.soldAt) + 86_400_000));
    try {
      Object.assign(
        context.animateurAuth,
        bearer((await login(world.app, context.animateur)).accessToken),
      );
      const next = await sale(context, customer, 1);
      expect(next.workDate).not.toBe(first.workDate);
      expect(next.skippedPromotions[0].code).toBe('CUSTOMER_LIMIT_REACHED');
    } finally {
      frozen.mockRestore();
    }
  });

  it('E-03 and BR-31: captures a changed rule version and evaluates separate promotions', async () => {
    const context = await setup({ entries: false });
    const before = await sale(context, undefined, 2);
    expect(before.entitlements[0].quantity).toBe(2);
    await prisma.ruleSet.update({ where: { id: context.rule.id }, data: { status: 'superseded' } });
    const agencyId = world.agency.id;
    const next = await prisma.ruleSet.create({
      data: {
        agencyId,
        campaignId: context.id,
        status: 'approved',
        version: context.rule.version + 1,
        effectiveFrom: new Date(),
      },
    });
    await prisma.campaignRule.create({
      data: {
        agencyId,
        ruleSetId: next.id,
        ruleType: 'customer_fields',
        config: { fullName: 'required', phone: 'optional', consentRequired: false },
      },
    });
    await world.refused(context.post(undefined), 422, 'CUSTOMER_FIELDS_REQUIRED');
    await world.refused(context.post({ ...customer, phone: '1234' }), 422, 'INVALID_PHONE');
    const second = await prisma.product.create({
      data: {
        agencyId,
        clientId: world.client.id,
        sku: randomUUID(),
        name: 'Second product',
        unitLabel: 'unit',
      },
    });
    await prisma.campaignProduct.create({
      data: { agencyId, campaignId: context.id, productId: second.id },
    });
    for (const product of [context.product, second])
      await prisma.promotion.create({
        data: {
          agencyId,
          ruleSetId: next.id,
          name: product.name,
          type: 'tiered_gift',
          tiers: {
            create: {
              agencyId,
              productId: product.id,
              stockItemId: context.gift.id,
              minQuantity: 2,
              giftQuantity: 4,
            },
          },
        },
      });
    expect((await sale(context, customer, 1)).entitlements).toEqual([]);
    const after = await world.ok(
      world.call(context.animateurAuth, 'post', `/assignments/${context.assignment.id}/sales`, {
        customer,
        items: [
          { productId: context.product.id, quantity: 2 },
          { productId: second.id, quantity: 2 },
        ],
      }),
      201,
    );
    expect(after.ruleSetId).toBe(next.id);
    expect(after.entitlements.map(({ quantity }) => quantity)).toEqual([4, 4]);
    expect((await get('director', '/sales/' + before.id)).entitlements[0].quantity).toBe(2);
  });

  it('BR-15 and BR-52: denies self-void, a drawn Tombola and a closed campaign', async () => {
    const context = await setup({ promotion: false });
    const first = await sale(context, customer, 1);
    const endpoint = `/sales/${first.id}/void`;
    const send = (actor, path = endpoint) =>
      world.call(actor, 'post', path, { reason: 'Wrong transaction' });
    await world.refused(send(context.animateurAuth), 403, 'FORBIDDEN');
    await prisma.tombola.update({ where: { id: context.tombola.id }, data: { status: 'drawn' } });
    await world.refused(send('director'), 409, 'TOMBOLA_ALREADY_DRAWN');
    expect((await get('director', '/sales/' + first.id)).tombolaEntries[0].status).toBe('valid');
    const second = await sale(context, undefined, 1);
    await prisma.campaign.update({ where: { id: context.id }, data: { status: 'closed' } });
    await world.refused(
      send('director', `/sales/${second.id}/void`),
      422,
      'FIELD_ENTRY_NOT_ALLOWED',
    );
  });

  it('counts per-unit entries up to the customer cap and closes expired registration', async () => {
    const context = await setup({ promotion: false });
    await prisma.tombola.update({
      where: { id: context.tombola.id },
      data: { entryBasis: 'per_unit', maxEntriesPerCustomer: 4 },
    });
    expect((await sale(context, customer)).tombolaEntries[0].numbers).toEqual([1, 2, 3]);
    expect((await sale(context, customer)).tombolaEntries[0].numbers).toEqual([4]);
    expect(
      (await sale(context, { ...customer, phone: '0550123457', consentTombola: false }))
        .tombolaEntries,
    ).toEqual([]);
    await prisma.tombola.update({
      where: { id: context.tombola.id },
      data: { registrationEndsAt: new Date(Date.now() - 1000) },
    });
    await closeExpired();
    expect((await prisma.tombola.findUnique({ where: { id: context.tombola.id } })).status).toBe(
      'closed',
    );
    expect((await sale(context, customer)).tombolaEntries).toEqual([]);
  });

  it('keeps Tombola configuration director-only and locks it once the campaign activates', async () => {
    const context = await setup({ promotion: false, entries: false });
    await prisma.campaign.update({ where: { id: context.id }, data: { status: 'assigned' } });
    const endpoint = `/campaigns/${context.id}/tombolas`;
    const input = {
      name: 'Weekend draw',
      entryBasis: 'per_sale',
      entriesPerBasis: 1,
      maxEntriesPerCustomer: null,
      requiresPurchase: true,
      registrationEndsAt: new Date(Date.now() + 3_600_000).toISOString(),
      drawScheduledAt: new Date(Date.now() + 7_200_000).toISOString(),
      winnersCount: 3,
      reservesCount: 1,
    };
    await world.refused(world.call('supervisor', 'post', endpoint, input), 403, 'FORBIDDEN');
    const row = await world.ok(world.call('director', 'post', endpoint, input), 201);
    await world.ok(world.call('director', 'patch', '/tombolas/' + row.id, { entriesPerBasis: 2 }));
    await prisma.campaign.update({ where: { id: context.id }, data: { status: 'active' } });
    await world.refused(
      world.call('director', 'patch', '/tombolas/' + row.id, { winnersCount: 4 }),
      409,
      'TOMBOLA_LOCKED',
    );
    expect(
      (await world.ok(world.call('director', 'post', '/tombolas/' + row.id + '/close', {}))).status,
    ).toBe('closed');
  });

  it('records append-only interactions and enforces field-entry restrictions', async () => {
    const context = await setup({ promotion: false, entries: false });
    const endpoint = `/assignments/${context.assignment.id}/interactions`;
    const row = await world.ok(
      world.call(context.animateurAuth, 'post', endpoint, { kind: 'tasting', count: 12 }),
      201,
    );
    const today = await get(context.animateurAuth, '/me/sales/today');
    expect(today.interactions.tasting).toBe(12);
    await expect(
      prisma.fieldInteraction.update({ where: { id: row.id }, data: { count: 13 } }),
    ).rejects.toThrow();
    await prisma.campaign.update({ where: { id: context.id }, data: { status: 'suspended' } });
    await world.refused(
      world.call(context.animateurAuth, 'post', endpoint, { kind: 'tasting', count: 1 }),
      422,
      'FIELD_ENTRY_NOT_ALLOWED',
    );
  });

  it('accepts a multipart sale with a PDF and keeps the proof scoped to internal readers', async () => {
    const context = await setup({ promotion: false, entries: false });
    const req = world
      .call(context.animateurAuth, 'post', `/assignments/${context.assignment.id}/sales`)
      .field('items', JSON.stringify([{ productId: context.product.id, quantity: 1 }]))
      .field('customer', JSON.stringify(customer))
      .field('invoiceRef', 'DEMO-123')
      .attach('proof', PDF, { filename: 'receipt.pdf', contentType: 'application/pdf' });
    const row = await world.ok(req, 201);
    expect(row.proofFileId).toBeTruthy();
    const fileUrl = '/files/' + row.proofFileId;
    expect((await world.call('supervisor', 'get', fileUrl)).status).toBe(200);
    await world.refused(world.call('clientUser', 'get', fileUrl), 404, 'NOT_FOUND');
    await world.refused(world.call('supervisorTwo', 'get', fileUrl), 404, 'NOT_FOUND');
  });

  it(
    'reconciles a repeatable mix of recorded, late-delivered and voided sales',
    { timeout: 30_000 },
    async () => {
      const context = await setup({ entries: false });
      await restock(context, 4);
      let seed = 22;
      const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
      const sales = [];
      for (let i = 0; i < 8; i++) sales.push(await sale(context, undefined, 1 + (next() % 3)));
      await restock(context, 12);
      for (const row of sales) {
        if (next() % 2) {
          await world.ok(
            world.call('supervisor', 'post', `/sales/${row.id}/void`, {
              reason: 'Audit correction',
            }),
          );
        } else if (row.entitlements[0].status === 'undelivered') {
          await world.ok(
            world.call(
              context.animateurAuth,
              'post',
              `/entitlements/${row.entitlements[0].id}/deliver`,
              {},
            ),
          );
        }
      }
      const report = await get('director', `/campaigns/${context.id}/stock/reconciliation`);
      expect(report.ok).toBe(true);
      const delivered = await prisma.giftEntitlement.aggregate({
        where: { campaignId: context.id, status: 'distributed' },
        _sum: { quantity: true },
      });
      expect(await world.balance(context, 'customers', context.gift)).toBe(delivered._sum.quantity);
    },
  );
});
