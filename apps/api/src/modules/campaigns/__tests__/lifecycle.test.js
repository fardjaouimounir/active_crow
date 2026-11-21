import { CAMPAIGN_STATUSES, TRANSITION_ACTIONS, TRANSITIONS } from '@fieldflow/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import {
  createCampaign,
  createProduct,
  createRuleSet,
  createStockItem,
  day,
} from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { registerTransitionGuard } from '../transitionGuards.js';
import { createWorld, offsetDate } from './fixtures.js';

const app = createApp();
const REASON = { reason: 'Requested by the client' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
let w;

beforeAll(async () => {
  w = await createWorld(app);
});

const act = (campaign, action, body = {}) =>
  w.send('post', `/campaigns/${campaign.id}/${action}`, 'director', body);
const readiness = async (campaign, actor = 'director') =>
  w.ok(w.send('get', `/campaigns/${campaign.id}/readiness`, actor));
const blockersOf = async (campaign, action) =>
  (await readiness(campaign)).actions.find((item) => item.action === action).blockers;
const statusOf = async (campaign) =>
  (await prisma.campaign.findUnique({ where: { id: campaign.id } })).status;

/** Locations and balances of a campaign built directly (stock is a later module). */
async function stockOf(campaign) {
  const base = { agencyId: w.agency.id, campaignId: campaign.id };
  const warehouse = await prisma.stockLocation.create({ data: { ...base, kind: 'warehouse' } });
  const holder = await prisma.stockLocation.create({
    data: { ...base, kind: 'holder', userId: w.people.animateur.id },
  });
  const customers = await prisma.stockLocation.create({ data: { ...base, kind: 'customers' } });
  const item = await createStockItem(w.agency.id, w.client.id);
  const balance = (location, kind, quantity) =>
    prisma.stockBalance.create({
      data: {
        agencyId: w.agency.id,
        locationId: location.id,
        stockItemId: item.id,
        locationKind: kind,
        quantity,
      },
    });
  const movement = (status) =>
    prisma.stockMovement.create({
      data: {
        ...base,
        type: 'transfer',
        status,
        fromLocationId: warehouse.id,
        toLocationId: holder.id,
        createdById: w.people.director.id,
      },
    });
  return { warehouse, holder, customers, balance, movement };
}

describe('FR-030 the state machine', () => {
  it('refuses every (status, action) pair that is not in the transition table', async () => {
    for (const status of CAMPAIGN_STATUSES) {
      const campaign = await createCampaign(w.agency.id, w.client.id, { status });
      for (const action of TRANSITION_ACTIONS) {
        if (TRANSITIONS[action].from.includes(status)) continue;
        const details = await w.rejected(act(campaign, action, REASON), 422, 'INVALID_TRANSITION');
        expect(details, `${status} · ${action}`).toEqual({ status, action });
      }
      expect(await statusOf(campaign)).toBe(status);
    }
  });

  const allowed = TRANSITION_ACTIONS.flatMap((action) =>
    TRANSITIONS[action].from.map((from) => [from, action, TRANSITIONS[action].to]),
  );

  it.each(allowed)('%s · %s succeeds when every guard passes → %s', async (from, action, to) => {
    const { campaign } = await w.readyCampaign({ status: from });
    expect(
      (await readiness(campaign)).actions.find((item) => item.action === action),
    ).toMatchObject({
      allowed: true,
      blockers: [],
    });
    const result = await w.ok(act(campaign, action, REASON));
    expect(result.status).toBe(to);
    expect(result.version).toBe(2);
    const [row] = (await w.ok(w.send('get', `/campaigns/${campaign.id}/status-history`))).slice(-1);
    expect(row).toMatchObject({
      fromStatus: from,
      toStatus: to,
      reason: REASON.reason,
      changedBy: { id: w.people.director.id },
    });
    const audit = await prisma.auditLog.findMany({
      where: { entityId: campaign.id, action: 'campaign.status_changed' },
      select: { before: true, after: true },
    });
    expect(audit).toEqual([
      {
        before: { status: from },
        after: { status: to, transition: action, reason: REASON.reason },
      },
    ]);
  });

  it('requires a reason where marked, and 3 to 500 characters when given', async () => {
    const active = await w.readyCampaign({ status: 'active' });
    for (const action of ['suspend', 'cancel', 'complete']) {
      const details = await w.rejected(act(active.campaign, action), 422, 'REASON_REQUIRED');
      expect(details).toEqual({ action });
    }
    await w.rejected(act(active.campaign, 'suspend', { reason: 'ab' }), 400, 'VALIDATION_FAILED');
    await w.rejected(
      act(active.campaign, 'suspend', { reason: 'x'.repeat(501) }),
      400,
      'VALIDATION_FAILED',
    );
    await w.rejected(act(active.campaign, 'suspend', { note: 'x' }), 400, 'VALIDATION_FAILED');
    expect(await statusOf(active.campaign)).toBe('active');
    const ended = await w.readyCampaign({
      status: 'active',
      startDate: day(offsetDate(-30)),
      endDate: day(offsetDate(-1)),
    });
    expect(
      (await readiness(ended.campaign)).actions.find((a) => a.action === 'complete'),
    ).toMatchObject({
      reasonRequired: false,
    });
    await w.ok(act(ended.campaign, 'complete'));
    const plan = await w.readyCampaign({ status: 'draft' });
    await w.ok(act(plan.campaign, 'plan'));
  });

  it('only the director may move a campaign', async () => {
    const { campaign } = await w.readyCampaign({ status: 'draft' });
    for (const actor of ['general', 'regional', 'supervisor', 'animateur', 'clientUser']) {
      await w.rejected(
        w.send('post', `/campaigns/${campaign.id}/plan`, actor, {}),
        403,
        'FORBIDDEN',
      );
    }
    await w.rejected(
      w.send('post', `/campaigns/${campaign.id}/plan`, null, {}),
      401,
      'UNAUTHENTICATED',
    );
  });

  it('lets exactly one of two concurrent activations win', async () => {
    const { campaign } = await w.readyCampaign({ status: 'assigned' });
    const results = await Promise.all([act(campaign, 'activate'), act(campaign, 'activate')]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 422]);
    expect(results.find((res) => res.status === 422).body.error.code).toBe('INVALID_TRANSITION');
    expect(
      await prisma.campaignStatusHistory.count({
        where: { campaignId: campaign.id, toStatus: 'active' },
      }),
    ).toBe(1);
    expect((await prisma.campaign.findUnique({ where: { id: campaign.id } })).version).toBe(2);
  });
});

describe('transition guards', () => {
  it('plan: needs a wilaya with a need and a product', async () => {
    const { campaign } = await w.draftCampaign({}, 0);
    expect(await blockersOf(campaign, 'plan')).toEqual([
      { code: 'NO_WILAYA_WITH_NEED' },
      { code: 'NO_PRODUCT' },
    ]);
    const details = await w.rejected(act(campaign, 'plan'), 422, 'TRANSITION_BLOCKED');
    expect(details.blockers).toEqual([{ code: 'NO_WILAYA_WITH_NEED' }, { code: 'NO_PRODUCT' }]);
    await w.ok(
      w.send('put', `/campaigns/${campaign.id}/wilayas`, 'director', {
        wilayas: [{ wilayaId: 16, requiredAnimateurs: 0 }],
      }),
    );
    expect(await blockersOf(campaign, 'plan')).toContainEqual({ code: 'NO_WILAYA_WITH_NEED' });
    // The need comes from the supervisors' quotas.
    await w.ok(
      w.send('post', `/campaigns/${campaign.id}/staff`, 'director', {
        userId: w.people.supervisor.id,
        wilayaId: 16,
        role: 'supervisor',
        requiredAnimateurs: 3,
      }),
      201,
    );
    const product = await createProduct(w.agency.id, w.client.id);
    await w.ok(
      w.send('put', `/campaigns/${campaign.id}/products`, 'director', { productIds: [product.id] }),
    );
    expect(await blockersOf(campaign, 'plan')).toEqual([]);
    expect((await w.ok(act(campaign, 'plan'))).status).toBe('planning');
  });

  it('mark-assigned: needs rules, points of sale, a supervisor and (if approver) a regional per wilaya', async () => {
    const campaign = await createCampaign(w.agency.id, w.client.id, { status: 'planning' });
    await prisma.campaignWilaya.create({
      data: { agencyId: w.agency.id, campaignId: campaign.id, wilayaId: 16, requiredAnimateurs: 1 },
    });
    expect(await blockersOf(campaign, 'mark-assigned')).toEqual([
      { code: 'NO_APPROVED_RULE_SET' },
      { code: 'NO_POINT_OF_SALE' },
      { code: 'WILAYA_WITHOUT_SUPERVISOR', details: { wilayaIds: [16] } },
      { code: 'WILAYA_WITHOUT_REGIONAL', details: { wilayaIds: [16] } },
    ]);
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { assignmentApproverRole: 'general_manager' },
    });
    expect((await blockersOf(campaign, 'mark-assigned')).map((item) => item.code)).toEqual([
      'NO_APPROVED_RULE_SET',
      'NO_POINT_OF_SALE',
      'WILAYA_WITHOUT_SUPERVISOR',
    ]);
    await createRuleSet(campaign, { status: 'draft' });
    expect((await blockersOf(campaign, 'mark-assigned'))[0]).toEqual({
      code: 'NO_APPROVED_RULE_SET',
    });
  });

  it('activate: BR-10 needs an approved assignment and today within the campaign dates', async () => {
    const future = await createCampaign(w.agency.id, w.client.id, {
      status: 'assigned',
      startDate: day(offsetDate(10)),
      endDate: day(offsetDate(40)),
    });
    await createRuleSet(future, { status: 'approved', effectiveFrom: new Date() });
    expect(await blockersOf(future, 'activate')).toEqual([
      { code: 'NO_APPROVED_ASSIGNMENT' },
      { code: 'BEFORE_START_DATE', details: { startDate: offsetDate(10) } },
    ]);
    const details = await w.rejected(act(future, 'activate'), 422, 'TRANSITION_BLOCKED');
    expect(details.blockers).toHaveLength(2);

    const over = await createCampaign(w.agency.id, w.client.id, {
      status: 'assigned',
      startDate: day(offsetDate(-30)),
      endDate: day(offsetDate(-1)),
    });
    expect(await blockersOf(over, 'activate')).toEqual([
      { code: 'NO_APPROVED_RULE_SET' },
      { code: 'NO_APPROVED_ASSIGNMENT' },
      { code: 'AFTER_END_DATE', details: { endDate: offsetDate(-1) } },
    ]);
  });

  it('resume: refused after the end date', async () => {
    const over = await createCampaign(w.agency.id, w.client.id, {
      status: 'suspended',
      startDate: day(offsetDate(-30)),
      endDate: day(offsetDate(-1)),
    });
    expect(await blockersOf(over, 'resume')).toEqual([
      { code: 'AFTER_END_DATE', details: { endDate: offsetDate(-1) } },
    ]);
    await w.rejected(act(over, 'resume'), 422, 'TRANSITION_BLOCKED');
  });

  it('BR-15 close: blocked by physical balances and by open movements, free when settled', async () => {
    const { campaign } = await w.readyCampaign({ status: 'completed' });
    const stock = await stockOf(campaign);
    await stock.balance(stock.holder, 'holder', 3);
    await stock.balance(stock.customers, 'customers', 40);
    const pending = await stock.movement('pending');
    await stock.movement('disputed');
    await stock.movement('pending_approval');
    await stock.movement('posted');
    await stock.movement('cancelled');
    const expected = [
      { code: 'PHYSICAL_STOCK_REMAINING', details: { count: 1 } },
      { code: 'OPEN_STOCK_MOVEMENTS', details: { count: 3 } },
    ];
    expect(await blockersOf(campaign, 'close')).toEqual(expected);
    expect((await w.rejected(act(campaign, 'close'), 422, 'TRANSITION_BLOCKED')).blockers).toEqual(
      expected,
    );

    await prisma.stockBalance.updateMany({
      where: { location: { campaignId: campaign.id }, locationKind: 'holder' },
      data: { quantity: 0 },
    });
    expect(await blockersOf(campaign, 'close')).toEqual([
      { code: 'OPEN_STOCK_MOVEMENTS', details: { count: 3 } },
    ]);
    await prisma.stockMovement.updateMany({
      where: {
        campaignId: campaign.id,
        status: { in: ['pending', 'disputed', 'pending_approval'] },
      },
      data: { status: 'posted' },
    });
    expect(pending.id).toBeTruthy();
    expect(await blockersOf(campaign, 'close')).toEqual([]);
    expect((await w.ok(act(campaign, 'close'))).status).toBe('closed');
  });

  it('cancel: refused while physical stock remains', async () => {
    const { campaign } = await w.readyCampaign({ status: 'active' });
    const stock = await stockOf(campaign);
    await stock.balance(stock.warehouse, 'warehouse', 10);
    expect(await blockersOf(campaign, 'cancel')).toEqual([
      { code: 'PHYSICAL_STOCK_REMAINING', details: { count: 1 } },
    ]);
    const details = await w.rejected(act(campaign, 'cancel', REASON), 422, 'CAMPAIGN_HAS_STOCK');
    expect(details.blockers).toEqual([{ code: 'PHYSICAL_STOCK_REMAINING', details: { count: 1 } }]);
    expect(await statusOf(campaign)).toBe('active');
    await prisma.stockBalance.updateMany({
      where: { location: { campaignId: campaign.id } },
      data: { quantity: 0 },
    });
    await w.ok(act(campaign, 'cancel', REASON));
  });

  describe('extension point', () => {
    let unregister;
    afterEach(() => unregister?.());

    it('runs guards registered by other modules, in readiness and in the transition', async () => {
      const { campaign } = await w.readyCampaign({ status: 'draft' });
      const seen = [];
      unregister = registerTransitionGuard('plan', ({ campaign: current, today }) => {
        seen.push([current.id, today]);
        return [{ code: 'TOMBOLA_NOT_CONFIGURED', details: { hint: 'test' } }];
      });
      expect((await readiness(campaign)).actions.find((a) => a.action === 'plan')).toMatchObject({
        allowed: false,
        blockers: [{ code: 'TOMBOLA_NOT_CONFIGURED', details: { hint: 'test' } }],
      });
      const details = await w.rejected(act(campaign, 'plan'), 422, 'TRANSITION_BLOCKED');
      expect(details.blockers).toEqual([
        { code: 'TOMBOLA_NOT_CONFIGURED', details: { hint: 'test' } },
      ]);
      expect(seen.length).toBeGreaterThanOrEqual(2);
      unregister();
      expect((await w.ok(act(campaign, 'plan'))).status).toBe('planning');
      expect(() => registerTransitionGuard('fly', () => [])).toThrow(/Unknown transition action/);
    });
  });
});

describe('readiness', () => {
  it('lists every action available from the status; staff in scope only', async () => {
    const { campaign } = await w.readyCampaign({ status: 'active' });
    const result = await readiness(campaign);
    expect(result.status).toBe('active');
    expect(result.actions.map((item) => item.action)).toEqual(['suspend', 'complete', 'cancel']);
    expect(result.actions[0]).toEqual({
      action: 'suspend',
      to: 'suspended',
      allowed: true,
      reasonRequired: true,
      blockers: [],
    });
    await readiness(campaign, 'supervisor');
    await readiness(campaign, 'general');
    for (const actor of ['supervisorTwo', 'clientUser', 'animateur']) {
      await w.rejected(
        w.send('get', `/campaigns/${campaign.id}/readiness`, actor),
        404,
        'NOT_FOUND',
      );
    }
    const closed = await createCampaign(w.agency.id, w.client.id, { status: 'closed' });
    expect((await readiness(closed)).actions).toEqual([]);
  });
});

describe('editing by status', () => {
  const patch = (campaign, body, version = 1) =>
    w.send('patch', `/campaigns/${campaign.id}`, 'director', { version, ...body });
  const area = async (request, code = 'FIELD_NOT_EDITABLE_IN_STATUS') =>
    (await w.rejected(request, 422, code)).area;
  const upload = (campaign) =>
    w
      .send('post', `/campaigns/${campaign.id}/documents`)
      .field('label', 'Final report')
      .attach('file', PDF, 'report.pdf');

  it('active: details, end-date extension, coverage, added products, documents and rules stay open', async () => {
    const { campaign, product } = await w.readyCampaign({ status: 'active' });
    const base = `/campaigns/${campaign.id}`;
    const renamed = await w.ok(patch(campaign, { name: 'Renamed while running' }));
    expect(renamed.version).toBe(2);
    expect(await area(patch(campaign, { startDate: offsetDate(-1) }, 2))).toBe('startDate');
    expect(await area(patch(campaign, { assignmentApproverRole: 'director' }, 2))).toBe('approver');
    const same = await w.ok(patch(campaign, { startDate: offsetDate(-5), name: 'Same dates' }, 2));
    expect(same.version).toBe(3);
    expect(await area(patch(campaign, { endDate: offsetDate(10) }, 3))).toBe('endDate');
    expect(await area(patch(campaign, { endDate: offsetDate(-2) }, 3))).toBe('endDate');
    const extended = await w.ok(patch(campaign, { endDate: offsetDate(60) }, 3));
    expect(extended.endDate).toBe(offsetDate(60));

    await w.ok(
      w.send('put', `${base}/wilayas`, 'director', {
        wilayas: [
          { wilayaId: 16, requiredAnimateurs: 2 },
          { wilayaId: 31, requiredAnimateurs: 1 },
        ],
      }),
    );
    const another = await createProduct(w.agency.id, w.client.id);
    await w.ok(
      w.send('put', `${base}/products`, 'director', { productIds: [product.id, another.id] }),
    );
    expect(
      await area(
        w.send('put', `${base}/products`, 'director', { productIds: [another.id] }),
        'PRODUCT_REMOVAL_LOCKED',
      ),
    ).toBe('products');
    await w.ok(upload(campaign), 201);
    const version = await w.ok(w.send('post', `${base}/rule-sets`), 201);
    expect(version.status).toBe('draft');
  });

  it('suspended behaves like active', async () => {
    const { campaign } = await w.readyCampaign({ status: 'suspended' });
    await w.ok(patch(campaign, { description: 'Paused for a week' }));
    expect(await area(patch(campaign, { startDate: offsetDate(-1) }, 2))).toBe('startDate');
  });

  it('planning and assigned: start date, approver and product removal are still open', async () => {
    const { campaign } = await w.readyCampaign({
      status: 'planning',
      startDate: day(offsetDate(5)),
    });
    const moved = await w.ok(
      patch(campaign, { startDate: offsetDate(8), assignmentApproverRole: 'director' }),
    );
    expect(moved).toMatchObject({ startDate: offsetDate(8), assignmentApproverRole: 'director' });
    await w.ok(w.send('put', `/campaigns/${campaign.id}/products`, 'director', { productIds: [] }));
    await w.rejected(
      patch(campaign, { startDate: offsetDate(-3) }, 2),
      422,
      'CAMPAIGN_START_IN_PAST',
    );
  });

  it('completed: only documents (final reports) can still be changed', async () => {
    const { campaign } = await w.readyCampaign({ status: 'completed' });
    const base = `/campaigns/${campaign.id}`;
    expect(await area(patch(campaign, { name: 'Late rename' }))).toBe('details');
    expect(
      await area(
        w.send('put', `${base}/wilayas`, 'director', {
          wilayas: [{ wilayaId: 16, requiredAnimateurs: 9 }],
        }),
      ),
    ).toBe('coverage');
    expect(await area(w.send('put', `${base}/products`, 'director', { productIds: [] }))).toBe(
      'products',
    );
    expect(await area(w.send('post', `${base}/rule-sets`))).toBe('ruleSet');
    expect(await area(patch(campaign, { endDate: offsetDate(90) }))).toBe('endDate');
    const document = await w.ok(upload(campaign), 201);
    await w.ok(
      w.send('patch', `${base}/documents/${document.id}`, 'director', { label: 'Final report v2' }),
    );
    await w.ok(w.send('delete', `${base}/documents/${document.id}`), 204);
  });

  it.each(['closed', 'cancelled'])(
    '%s: nothing can be changed, not even documents',
    async (status) => {
      const { campaign } = await w.readyCampaign({ status });
      expect(await area(upload(campaign))).toBe('documents');
      expect(await area(patch(campaign, { description: 'x' }))).toBe('details');
      expect(await area(w.send('post', `/campaigns/${campaign.id}/rule-sets`))).toBe('ruleSet');
    },
  );

  it('rule-set drafts cannot be edited once the campaign is frozen', async () => {
    const { campaign } = await w.draftCampaign();
    const draft = await prisma.ruleSet.findFirst({ where: { campaignId: campaign.id } });
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'cancelled' } });
    await w.rejected(
      w.send('put', `/campaigns/${campaign.id}/rule-sets/${draft.id}/promotions`, 'director', {
        promotions: [],
      }),
      422,
      'FIELD_NOT_EDITABLE_IN_STATUS',
    );
  });
});
