// The demo data generator (`npm run seed:showcase`), on a tiny cast so it stays fast: one running
// campaign, four Animateurs, three stores, three days. Safety rules, stock reconciliation, KPI
// consistency, attendance, the Tombola, and today's top-up. The closed campaign, the report and the
// calibration of the patterns are in showcase.full.test.js (`npm run seed:showcase:check`, opt-in).
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/core/auth/tokens.js';
import { businessDate, clock } from '../src/core/time/clock.js';
import { prisma } from '../src/db/client.js';
import { EMAIL_DOMAIN } from '../prisma/seed/showcaseData.js';
import { addDays } from '../prisma/seed/showcasePlan.js';
import { ShowcaseRefusal, runShowcase } from '../prisma/seed/showcaseRun.js';

const PASSWORD = 'demo-only-password-123';
const savedDemoMode = process.env.DEMO_MODE;
afterAll(() => {
  if (savedDemoMode === undefined) delete process.env.DEMO_MODE;
  else process.env.DEMO_MODE = savedDemoMode;
});

describe('safety rules', () => {
  it('refuses to run without DEMO_MODE=true', async () => {
    for (const value of [undefined, 'false', '1', 'TRUE']) {
      if (value === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = value;
      await expect(runShowcase({ tiny: true, password: PASSWORD })).rejects.toThrow(
        ShowcaseRefusal,
      );
    }
    expect(await prisma.campaign.count()).toBe(0);
  });

  it('refuses a database that holds non-demo data and leaves it untouched', async () => {
    process.env.DEMO_MODE = 'true';
    const agency = await prisma.agency.create({
      data: { code: 'REAL-AGENCY', name: 'Real agency' },
    });
    await prisma.user.create({
      data: {
        agencyId: agency.id,
        role: 'director',
        fullName: 'A real director',
        email: 'real.director@example.org',
        passwordHash: 'x',
      },
    });
    await expect(runShowcase({ tiny: true, password: PASSWORD })).rejects.toThrow(/non-demo data/);
    expect(await prisma.user.count({ where: { email: 'real.director@example.org' } })).toBe(1);
    await prisma.user.deleteMany({});
    await prisma.agency.deleteMany({ where: { id: agency.id } });
  });

  it('refuses --refresh-today when nothing was generated yet', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(
      runShowcase({ refreshToday: true, tiny: true, password: PASSWORD, now: '10:00' }),
    ).rejects.toThrow(/Nothing to refresh/);
  });
});

describe('generated data (tiny cast)', () => {
  const app = createApp();
  let ctx;
  let director;
  const today = businessDate(clock.now());

  const get = async (path) => {
    const { accessToken } = await signAccessToken(director);
    const res = await request(app)
      .get('/api/v1' + path)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(res.status, `${path} → ${res.status}`).toBe(200);
    return res.body.data;
  };
  const todaysCounts = async () => ({
    sales: await prisma.sale.count({ where: { workDate: new Date(today) } }),
    records: await prisma.attendanceRecord.count({ where: { workDate: new Date(today) } }),
  });
  const campaignId = () => ctx.campaigns[0].row.id;

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    ctx = await runShowcase({ tiny: true, password: PASSWORD, now: '09:30' });
    director = await prisma.user.findUniqueOrThrow({
      where: { email: `director@${EMAIL_DOMAIN}` },
    });
  }, 120_000);

  it('runs without a refused call and flags everything as demo', async () => {
    expect(ctx.failures).toEqual([]);
    expect(await prisma.user.count({ where: { isDemo: false } })).toBe(0);
    expect(await prisma.pointOfSale.count({ where: { isDemo: false } })).toBe(0);
    const roles = await prisma.user.groupBy({ by: ['role'], _count: true });
    expect(Object.fromEntries(roles.map((r) => [r.role, r._count]))).toEqual({
      director: 1,
      general_manager: 1,
      regional_manager: 2,
      supervisor: 4,
      animateur: 4,
      client: 1,
    });
    expect(await prisma.pointOfSale.count()).toBe(3);
  });

  it('has an active campaign dated from the run day, with a sales target and a tiered promotion', async () => {
    const campaign = await prisma.campaign.findFirstOrThrow();
    expect(campaign.status).toBe('active');
    expect(campaign.startDate.toISOString().slice(0, 10)).toBe(addDays(today, -2));
    const rule = await prisma.campaignRule.findFirst({
      where: { ruleType: 'sales_target', ruleSet: { campaignId: campaign.id, status: 'approved' } },
    });
    expect(rule.config.dailyUnitsPerAnimateur).toBeGreaterThan(0);
    const tiers = await prisma.promotionTier.count({
      where: { promotion: { ruleSet: { campaignId: campaign.id } } },
    });
    expect(tiers).toBeGreaterThanOrEqual(2);
  });

  it('Prompt 10: the stock reconciliation passes', async () => {
    const result = await get(`/campaigns/${campaignId()}/stock/reconciliation`);
    expect(result.ok).toBe(true);
    expect(result.rows.every((row) => row.check.ok)).toBe(true);
    expect(result.totals.balancedToZero).toBe(true);
  });

  it('Prompt 14: KPI totals equal the sum of their breakdowns', async () => {
    const query = `campaignIds=${campaignId()}&from=${addDays(today, -2)}&to=${today}`;
    const total = await get(`/reports/kpis?${query}`);
    expect(Number(total.sales.units)).toBeGreaterThan(0);
    for (const dimension of ['animateur', 'day', 'wilaya', 'point_of_sale', 'product']) {
      const rows = await get(`/reports/breakdown?${query}&dimension=${dimension}`);
      const sum = (pick) => rows.reduce((acc, row) => acc + Number(pick(row) ?? 0), 0);
      expect(
        sum((r) => r.sales.units),
        `${dimension} units`,
      ).toBe(Number(total.sales.units));
      expect(
        sum((r) => r.sales.count),
        `${dimension} sales`,
      ).toBe(Number(total.sales.count));
      if (dimension !== 'product')
        expect(
          sum((r) => r.attendance.verified),
          `${dimension} verified`,
        ).toBe(Number(total.attendance.verified));
    }
    expect(Number(total.gifts.distributedUnits)).toBeLessThanOrEqual(
      Number(total.gifts.entitledUnits),
    );
  });

  it('has attendance with a positive rate', async () => {
    const kpis = await get(
      `/reports/kpis?campaignIds=${campaignId()}&from=${addDays(today, -2)}&to=${today}`,
    );
    expect(kpis.attendance.rate).toBeGreaterThan(0);
    expect(await prisma.attendanceRecord.count()).toBeGreaterThan(0);
  });

  it('has an open Tombola with entries and a dispute resolved as a loss', async () => {
    const tombola = await prisma.tombola.findUniqueOrThrow({
      where: { id: ctx.campaigns[0].tombolaId },
    });
    expect(tombola.status).toBe('open');
    expect(await prisma.tombolaEntry.count({ where: { tombolaId: tombola.id } })).toBeGreaterThan(
      0,
    );
    const disputed = await prisma.stockMovement.findMany({
      where: { status: 'disputed' },
      include: { resolvedBy: true },
    });
    expect(disputed).toHaveLength(1);
    expect(disputed[0].resolvedBy).toHaveLength(1);
  });

  it("--refresh-today adds today's activity and is idempotent for the same hour", async () => {
    const before = await todaysCounts();
    expect(before.records).toBeGreaterThan(0);
    const refresh = () =>
      runShowcase({ refreshToday: true, tiny: true, password: PASSWORD, now: '15:00' });
    await refresh();
    const afternoon = await todaysCounts();
    expect(afternoon.sales).toBeGreaterThan(before.sales);
    await refresh();
    expect(await todaysCounts()).toEqual(afternoon);
  }, 120_000);
});
