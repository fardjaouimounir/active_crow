import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { clock } from '../../../core/time/clock.js';
import { createPointOfSale, createStockItem, day } from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { attendanceRule, createWorld, customerFieldsRule, offsetDate } from './fixtures.js';

const app = createApp();
let w;

beforeAll(async () => {
  w = await createWorld(app);
});

afterEach(() => vi.restoreAllMocks());

const rulePath = (campaign, ruleSetId, type) =>
  `/campaigns/${campaign.id}/rule-sets/${ruleSetId}/rules/${type}`;
const setPath = (campaign, ruleSetId) => `/campaigns/${campaign.id}/rule-sets/${ruleSetId}`;

const tier = (minQuantity, stockItemId, giftQuantity = 1) => ({
  minQuantity,
  stockItemId,
  giftQuantity,
});
const gwp = (stockItemId, over = {}) => ({
  type: 'gift_with_purchase',
  name: 'Free gift',
  productId: null,
  maxPerCustomer: null,
  tiers: [tier(1, stockItemId)],
  ...over,
});

async function saveRequired(campaign, ruleSetId) {
  await w.ok(
    w.send('put', rulePath(campaign, ruleSetId, 'attendance'), 'director', attendanceRule),
  );
  await w.ok(
    w.send('put', rulePath(campaign, ruleSetId, 'customer_fields'), 'director', customerFieldsRule),
  );
}

describe('FR-033 rules of a draft', () => {
  it('saves, replaces and removes rules, with the field path on every error', async () => {
    const { campaign, ruleSetId, products } = await w.draftCampaign();
    await saveRequired(campaign, ruleSetId);
    const replaced = await w.ok(
      w.send('put', rulePath(campaign, ruleSetId, 'attendance'), 'director', {
        ...attendanceRule,
        lateToleranceMinutes: 30,
      }),
    );
    expect(replaced.lateToleranceMinutes).toBe(30);
    const detail = await w.ok(w.send('get', setPath(campaign, ruleSetId)));
    expect(detail).toMatchObject({
      version: 1,
      status: 'draft',
      rules: { attendance: { lateToleranceMinutes: 30 }, customer_fields: customerFieldsRule },
      promotions: [],
    });

    const bad = {
      ...attendanceRule,
      checkpoints: [{ ...attendanceRule.checkpoints[0], window: ['10:00', '09:00'] }],
    };
    const details = await w.rejected(
      w.send('put', rulePath(campaign, ruleSetId, 'attendance'), 'director', bad),
      400,
      'VALIDATION_FAILED',
    );
    expect(details).toEqual([expect.objectContaining({ path: 'body.checkpoints.0.window.1' })]);
    await w.rejected(
      w.send('put', rulePath(campaign, ruleSetId, 'bonus'), 'director', {}),
      400,
      'VALIDATION_FAILED',
    );

    await w.ok(
      w.send('put', rulePath(campaign, ruleSetId, 'uniform'), 'director', {
        required: false,
        description: null,
      }),
    );
    await w.ok(w.send('delete', rulePath(campaign, ruleSetId, 'uniform')), 204);
    await w.rejected(w.send('delete', rulePath(campaign, ruleSetId, 'uniform')), 404, 'NOT_FOUND');
    const required = await w.rejected(
      w.send('delete', rulePath(campaign, ruleSetId, 'attendance')),
      422,
      'BUSINESS_RULE_VIOLATION',
    );
    expect(required.reason).toBe('REQUIRED_RULE_TYPE');
    await w.rejected(
      w.send('put', rulePath(campaign, ruleSetId, 'uniform'), 'supervisor', {
        required: true,
        description: null,
      }),
      403,
      'FORBIDDEN',
    );
    expect(products).toHaveLength(2);
  });

  it('checks that targets refer to campaign products and to a sample of the client', async () => {
    const { campaign, ruleSetId, products } = await w.draftCampaign({}, 1);
    const foreign = await w.otherClient.id;
    const sample = await w.sample();
    const gift = await w.gift();
    const otherSample = await createStockItem(w.agency.id, foreign, { kind: 'sample' });
    const sales = (productId) => ({
      dailyUnitsPerAnimateur: 30,
      perProduct: [{ productId, dailyUnits: 10 }],
    });
    const unknown = await w.rejected(
      w.send('put', rulePath(campaign, ruleSetId, 'sales_target'), 'director', sales(sample.id)),
      422,
      'INVALID_RULE_CONFIG',
    );
    expect(unknown).toMatchObject({
      ruleType: 'sales_target',
      path: 'body.perProduct.0.productId',
    });
    await w.ok(
      w.send(
        'put',
        rulePath(campaign, ruleSetId, 'sales_target'),
        'director',
        sales(products[0].id),
      ),
    );
    for (const stockItemId of [gift.id, otherSample.id]) {
      const refusal = await w.rejected(
        w.send('put', rulePath(campaign, ruleSetId, 'sampling_target'), 'director', {
          dailySamplesPerAnimateur: 50,
          stockItemId,
        }),
        422,
        'INVALID_RULE_CONFIG',
      );
      expect(refusal.path).toBe('body.stockItemId');
    }
    await w.ok(
      w.send('put', rulePath(campaign, ruleSetId, 'sampling_target'), 'director', {
        dailySamplesPerAnimateur: 50,
        stockItemId: sample.id,
      }),
    );
  });
});

describe('FR-090 promotions of a draft', () => {
  const put = (campaign, ruleSetId, promotions) =>
    w.send('put', `${setPath(campaign, ruleSetId)}/promotions`, 'director', { promotions });

  it('saves a tiered promotion and returns its tiers in order', async () => {
    const { campaign, ruleSetId, products } = await w.draftCampaign();
    const [a, b, c] = await Promise.all([w.gift(), w.gift(), w.gift()]);
    const saved = await w.ok(
      put(campaign, ruleSetId, [
        {
          type: 'tiered_gift',
          name: 'Buy more',
          productId: products[0].id,
          maxPerCustomer: 2,
          tiers: [tier(3, c.id, 3), tier(1, a.id, 1), tier(2, b.id, 2)].sort(
            (x, y) => x.minQuantity - y.minQuantity,
          ),
        },
      ]),
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ productId: products[0].id, maxPerCustomer: 2 });
    expect(saved[0].tiers.map((item) => [item.minQuantity, item.giftQuantity])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    const replaced = await w.ok(put(campaign, ruleSetId, [gwp(a.id)]));
    expect(replaced).toHaveLength(1);
    expect(await prisma.promotionTier.count({ where: { promotion: { ruleSetId } } })).toBe(1);
    expect(await w.ok(put(campaign, ruleSetId, []))).toEqual([]);
  });

  it('PROMOTION_INVALID names the reason and the field for every structure rule', async () => {
    const { campaign, ruleSetId } = await w.draftCampaign();
    const g = await w.gift();
    const tiered = (tiers, over = {}) => ({
      type: 'tiered_gift',
      name: 'Tiered',
      productId: null,
      maxPerCustomer: null,
      tiers,
      ...over,
    });
    const cases = [
      [
        'GWP_REQUIRES_ONE_TIER',
        gwp(g.id, { tiers: [tier(1, g.id), tier(2, g.id)] }),
        'body.promotions.0.tiers',
      ],
      [
        'GWP_MIN_QUANTITY_MUST_BE_1',
        gwp(g.id, { tiers: [tier(2, g.id)] }),
        'body.promotions.0.tiers.0.minQuantity',
      ],
      ['TIERED_REQUIRES_2_TO_6_TIERS', tiered([tier(1, g.id)]), 'body.promotions.0.tiers'],
      [
        'TIERED_REQUIRES_2_TO_6_TIERS',
        tiered([1, 2, 3, 4, 5, 6, 7].map((n) => tier(n, g.id))),
        'body.promotions.0.tiers',
      ],
      [
        'TIERS_NOT_STRICTLY_INCREASING',
        tiered([tier(2, g.id), tier(2, g.id, 2)]),
        'body.promotions.0.tiers.1.minQuantity',
      ],
      [
        'TIERS_NOT_STRICTLY_INCREASING',
        tiered([tier(3, g.id), tier(2, g.id, 2)]),
        'body.promotions.0.tiers.1.minQuantity',
      ],
      [
        'GIFT_QUANTITY_OUT_OF_RANGE',
        gwp(g.id, { tiers: [tier(1, g.id, 0)] }),
        'body.promotions.0.tiers.0.giftQuantity',
      ],
      [
        'GIFT_QUANTITY_OUT_OF_RANGE',
        gwp(g.id, { tiers: [tier(1, g.id, 101)] }),
        'body.promotions.0.tiers.0.giftQuantity',
      ],
    ];
    for (const [reason, promotion, path] of cases) {
      const details = await w.rejected(
        put(campaign, ruleSetId, [promotion]),
        422,
        'PROMOTION_INVALID',
      );
      expect(details, reason).toEqual({ reason, path });
    }
    await w.rejected(
      put(campaign, ruleSetId, [gwp(g.id, { maxPerCustomer: 101 })]),
      400,
      'VALIDATION_FAILED',
    );
    await w.rejected(put(campaign, ruleSetId, [gwp(g.id, { name: '' })]), 400, 'VALIDATION_FAILED');
  });

  it('refuses gifts of another client, samples, deleted gifts and products outside the campaign', async () => {
    const { campaign, ruleSetId, products } = await w.draftCampaign({}, 1);
    const sample = await w.sample();
    const foreignGift = await createStockItem(w.agency.id, w.otherClient.id, { kind: 'gift' });
    const deleted = await w.gift({ deletedAt: new Date() });
    for (const item of [sample, foreignGift, deleted]) {
      const details = await w.rejected(
        put(campaign, ruleSetId, [gwp(item.id)]),
        422,
        'GIFT_NOT_OF_CLIENT',
      );
      expect(details.path).toBe('body.promotions.0.tiers.0.stockItemId');
    }
    const g = await w.gift();
    const outside = await w.ok(w.send('get', '/campaigns/' + campaign.id)); // campaign has 1 product
    expect(outside.products).toHaveLength(1);
    const stranger = await createStockItem(w.agency.id, w.client.id, { kind: 'gift' });
    const notLinked = await prisma.product.create({
      data: {
        agencyId: w.agency.id,
        clientId: w.client.id,
        sku: 'NOT-LINKED',
        name: 'x',
        unitLabel: 'u',
      },
    });
    const details = await w.rejected(
      put(campaign, ruleSetId, [gwp(g.id, { productId: notLinked.id })]),
      422,
      'PRODUCT_NOT_IN_CAMPAIGN',
    );
    expect(details.path).toBe('body.promotions.0.productId');
    await w.ok(put(campaign, ruleSetId, [gwp(stranger.id, { productId: products[0].id })]));
  });

  it('forbids overlapping product scopes', async () => {
    const { campaign, ruleSetId, products } = await w.draftCampaign();
    const g = await w.gift();
    const scoped = (productId, name) => gwp(g.id, { productId, name });
    await w.ok(
      put(campaign, ruleSetId, [scoped(products[0].id, 'A'), scoped(products[1].id, 'B')]),
    );
    const overlaps = [
      [scoped(products[0].id, 'A'), scoped(products[0].id, 'B')],
      [scoped(null, 'All'), scoped(products[0].id, 'B')],
      [scoped(products[0].id, 'A'), scoped(null, 'All')],
      [scoped(null, 'All'), scoped(null, 'Other all')],
    ];
    for (const promotions of overlaps) {
      await w.rejected(put(campaign, ruleSetId, promotions), 422, 'PROMOTION_SCOPE_OVERLAP');
    }
    await w.ok(put(campaign, ruleSetId, [scoped(null, 'Only one')]));
  });
});

describe('BR-14 approval and versions', () => {
  it('refuses an incomplete rule set and re-validates everything at approval', async () => {
    const { campaign, ruleSetId, products } = await w.draftCampaign();
    const approve = () => w.send('post', `${setPath(campaign, ruleSetId)}/approve`);
    const missing = await w.rejected(approve(), 422, 'RULE_SET_INCOMPLETE');
    expect(missing.missing).toEqual(['attendance', 'customer_fields']);
    await saveRequired(campaign, ruleSetId);
    const gift = await w.gift();
    await w.ok(
      w.send('put', `${setPath(campaign, ruleSetId)}/promotions`, 'director', {
        promotions: [gwp(gift.id, { productId: products[0].id })],
      }),
    );
    await w.ok(
      w.send('put', rulePath(campaign, ruleSetId, 'sales_target'), 'director', {
        dailyUnitsPerAnimateur: 5,
        perProduct: [{ productId: products[1].id, dailyUnits: 5 }],
      }),
    );
    // Things change after the draft was saved: the gift is deleted, a product leaves the campaign.
    await prisma.stockItem.update({ where: { id: gift.id }, data: { deletedAt: new Date() } });
    await w.ok(
      w.send('put', `/campaigns/${campaign.id}/products`, 'director', {
        productIds: [products[0].id],
      }),
    );
    const details = await w.rejected(approve(), 422, 'INVALID_RULE_CONFIG');
    expect(details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: 'rule',
          ruleType: 'sales_target',
          path: 'perProduct.0.productId',
        }),
        expect.objectContaining({ scope: 'promotion', code: 'GIFT_NOT_OF_CLIENT' }),
      ]),
    );
    await w.rejected(
      w.send('post', `${setPath(campaign, ruleSetId)}/approve`, 'general'),
      403,
      'FORBIDDEN',
    );
    expect(await prisma.ruleSet.findUnique({ where: { id: ruleSetId } })).toMatchObject({
      status: 'draft',
    });
  });

  it('versions: approve v1, clone v2, edit, approve v2, and read the version in force at any time', async () => {
    const { campaign, ruleSetId, products } = await w.draftCampaign();
    const gift = await w.gift();
    const second = await w.gift();
    await saveRequired(campaign, ruleSetId);
    await w.ok(
      w.send('put', `${setPath(campaign, ruleSetId)}/promotions`, 'director', {
        promotions: [
          {
            type: 'tiered_gift',
            name: 'Tiered',
            productId: products[0].id,
            maxPerCustomer: null,
            tiers: [tier(1, gift.id), tier(2, second.id, 2)],
          },
        ],
      }),
    );
    const base = Date.now();
    const at = (minutes) => new Date(base + minutes * 60_000);
    const approveAt = async (id, minutes) => {
      const spy = vi.spyOn(clock, 'now').mockReturnValue(at(minutes));
      try {
        return await w.ok(w.send('post', `${setPath(campaign, id)}/approve`));
      } finally {
        spy.mockRestore();
      }
    };
    const v1 = await approveAt(ruleSetId, 1);
    expect(v1).toMatchObject({
      version: 1,
      status: 'approved',
      effectiveFrom: at(1).toISOString(),
      approvedBy: { id: w.people.director.id },
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: ruleSetId, action: 'campaign.rule_set_approved' },
      select: { after: true },
    });
    expect(audit.after).toMatchObject({
      version: 1,
      ruleTypes: ['attendance', 'customer_fields'],
      promotions: [{ name: 'Tiered', type: 'tiered_gift', tiers: 2 }],
    });

    // The approved version is never edited.
    for (const request of [
      w.send('put', rulePath(campaign, ruleSetId, 'uniform'), 'director', {
        required: false,
        description: null,
      }),
      w.send('delete', rulePath(campaign, ruleSetId, 'uniform')),
      w.send('put', `${setPath(campaign, ruleSetId)}/promotions`, 'director', { promotions: [] }),
      w.send('post', `${setPath(campaign, ruleSetId)}/approve`),
      w.send('delete', setPath(campaign, ruleSetId)),
    ]) {
      await w.rejected(request, 422, 'RULE_SET_NOT_DRAFT');
    }

    const v2 = await w.ok(w.send('post', `/campaigns/${campaign.id}/rule-sets`), 201);
    expect(v2).toMatchObject({ version: 2, status: 'draft', effectiveFrom: null });
    expect(v2.rules).toEqual(v1.rules);
    expect(v2.promotions).toHaveLength(1);
    expect(v2.promotions[0].id).not.toBe(v1.promotions[0].id);
    expect(v2.promotions[0].tiers.map((item) => item.id)).not.toEqual(
      v1.promotions[0].tiers.map((item) => item.id),
    );
    expect(
      v2.promotions[0].tiers.map(({ minQuantity, giftQuantity }) => [minQuantity, giftQuantity]),
    ).toEqual([
      [1, 1],
      [2, 2],
    ]);
    const duplicate = await w.rejected(
      w.send('post', `/campaigns/${campaign.id}/rule-sets`),
      409,
      'DRAFT_ALREADY_EXISTS',
    );
    expect(duplicate).toBeUndefined();

    await w.ok(
      w.send('put', rulePath(campaign, v2.id, 'attendance'), 'director', {
        ...attendanceRule,
        lateToleranceMinutes: 5,
      }),
    );
    await w.ok(
      w.send('put', `${setPath(campaign, v2.id)}/promotions`, 'director', {
        promotions: [
          {
            type: 'tiered_gift',
            name: 'Tiered',
            productId: products[0].id,
            maxPerCustomer: null,
            tiers: [tier(1, gift.id), tier(2, second.id, 5)],
          },
        ],
      }),
    );
    // v1 is untouched by edits of v2.
    const stillV1 = await w.ok(w.send('get', setPath(campaign, ruleSetId)));
    expect(stillV1.rules.attendance.lateToleranceMinutes).toBe(15);
    expect(stillV1.promotions[0].tiers[1].giftQuantity).toBe(2);

    await approveAt(v2.id, 2);
    const list = await w.ok(w.send('get', `/campaigns/${campaign.id}/rule-sets`));
    expect(list.map((item) => [item.version, item.status])).toEqual([
      [2, 'approved'],
      [1, 'superseded'],
    ]);
    const effective = (when) =>
      w.send(
        'get',
        `/campaigns/${campaign.id}/rule-sets/effective?at=${encodeURIComponent(when.toISOString())}`,
      );
    await w.rejected(effective(new Date(at(1).getTime() - 1000)), 404, 'NOT_FOUND');
    expect((await w.ok(effective(at(1)))).version).toBe(1);
    expect((await w.ok(effective(new Date(at(2).getTime() - 1000)))).version).toBe(1);
    expect((await w.ok(effective(at(2)))).version).toBe(2);
    expect((await w.ok(effective(at(60)))).version).toBe(2);
    await w.rejected(
      w.send('get', `/campaigns/${campaign.id}/rule-sets/effective?at=yesterday`),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('discards a draft of version 2 or later only', async () => {
    const { campaign, ruleSetId } = await w.draftCampaign();
    const first = await w.rejected(
      w.send('delete', setPath(campaign, ruleSetId)),
      422,
      'BUSINESS_RULE_VIOLATION',
    );
    expect(first.reason).toBe('FIRST_VERSION');
    await saveRequired(campaign, ruleSetId);
    await w.ok(w.send('post', `${setPath(campaign, ruleSetId)}/approve`));
    const v2 = await w.ok(w.send('post', `/campaigns/${campaign.id}/rule-sets`), 201);
    await w.ok(w.send('delete', setPath(campaign, v2.id)), 204);
    await w.rejected(w.send('get', setPath(campaign, v2.id)), 404, 'NOT_FOUND');
    expect(await prisma.campaignRule.count({ where: { ruleSetId: v2.id } })).toBe(0);
    const again = await w.ok(w.send('post', `/campaigns/${campaign.id}/rule-sets`), 201);
    // A discarded draft was never approved, so its number is free again.
    expect(again.version).toBe(2);
  });
});

describe('concurrent rule set changes', () => {
  it('creates exactly one draft when two new versions are requested at once', async () => {
    const { campaign, ruleSetId } = await w.draftCampaign();
    await saveRequired(campaign, ruleSetId);
    await w.ok(w.send('post', `${setPath(campaign, ruleSetId)}/approve`));
    const results = await Promise.all([
      w.send('post', `/campaigns/${campaign.id}/rule-sets`),
      w.send('post', `/campaigns/${campaign.id}/rule-sets`),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.find((res) => res.status === 409).body.error.code).toBe('DRAFT_ALREADY_EXISTS');
    expect(
      await prisma.ruleSet.count({ where: { campaignId: campaign.id, status: 'draft' } }),
    ).toBe(1);
  });

  it('approves a draft once when two approvals race', async () => {
    const { campaign, ruleSetId } = await w.draftCampaign();
    await saveRequired(campaign, ruleSetId);
    const results = await Promise.all([
      w.send('post', `${setPath(campaign, ruleSetId)}/approve`),
      w.send('post', `${setPath(campaign, ruleSetId)}/approve`),
    ]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 422]);
    expect(results.find((res) => res.status === 422).body.error.code).toBe('RULE_SET_NOT_DRAFT');
    expect(
      await prisma.ruleSet.count({ where: { campaignId: campaign.id, status: 'approved' } }),
    ).toBe(1);
  });
});

describe('rule set scope', () => {
  it('lets staff in scope read, hides rules from clients, and gives Animateurs the effective version only', async () => {
    const { campaign, ruleSetId } = await w.draftCampaign();
    await saveRequired(campaign, ruleSetId);
    await w.ok(w.send('post', `${setPath(campaign, ruleSetId)}/approve`));
    await w.ok(
      w.send('put', `/campaigns/${campaign.id}/wilayas`, 'director', {
        wilayas: [{ wilayaId: 16, requiredAnimateurs: 1 }],
      }),
    );
    await w.ok(
      w.send('post', `/campaigns/${campaign.id}/staff`, 'director', {
        userId: w.people.supervisor.id,
        wilayaId: 16,
        role: 'supervisor',
      }),
      201,
    );
    const base = `/campaigns/${campaign.id}/rule-sets`;
    for (const actor of ['director', 'general', 'supervisor']) {
      await w.ok(w.send('get', base, actor));
      await w.ok(w.send('get', `${base}/${ruleSetId}`, actor));
      await w.ok(w.send('get', `${base}/effective`, actor));
    }
    await w.rejected(w.send('get', base, 'supervisorTwo'), 404, 'NOT_FOUND');
    await w.rejected(w.send('get', `${base}/effective`, 'supervisorTwo'), 404, 'NOT_FOUND');
    await w.rejected(w.send('get', base, 'regionalTwo'), 404, 'NOT_FOUND');
    for (const path of [base, `${base}/${ruleSetId}`, `${base}/effective`]) {
      await w.rejected(w.send('get', path, 'clientUser'), 404, 'NOT_FOUND');
    }

    // Animateur: no assignment → the campaign is out of scope; approved assignment → effective only.
    await w.rejected(w.send('get', `${base}/effective`, 'animateur'), 404, 'NOT_FOUND');
    const pointOfSale = await createPointOfSale(w.agency.id, { wilayaId: 16 });
    await w.ok(
      w.send('put', `/campaigns/${campaign.id}/points-of-sale`, 'director', {
        pointOfSaleIds: [pointOfSale.id],
      }),
    );
    await prisma.assignment.create({
      data: {
        agencyId: w.agency.id,
        campaignId: campaign.id,
        animateurId: w.people.animateur.id,
        pointOfSaleId: pointOfSale.id,
        supervisorId: w.people.supervisor.id,
        proposedById: w.people.director.id,
        startDate: day(offsetDate(12)),
        endDate: day(offsetDate(20)),
        status: 'approved',
      },
    });
    const effective = await w.ok(w.send('get', `${base}/effective`, 'animateur'));
    expect(effective.status).toBe('approved');
    await w.rejected(w.send('get', base, 'animateur'), 404, 'NOT_FOUND');
    await w.rejected(w.send('get', `${base}/${ruleSetId}`, 'animateur'), 404, 'NOT_FOUND');
  });
});
