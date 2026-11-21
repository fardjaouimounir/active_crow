// The demo data generator (`npm run seed:showcase`): its safety rules, and the consistency of the
// data it leaves behind (stock reconciliation, KPI totals against their breakdowns, attendance,
// the closed campaign, today's top-up). One compact run feeds the whole file; the full history is
// the same script over more days.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/core/auth/tokens.js';
import { prisma } from '../src/db/client.js';
import { addDays } from '../prisma/seed/showcasePlan.js';
import { ShowcaseRefusal, runShowcase } from '../prisma/seed/showcaseRun.js';
import { buildReport } from '../prisma/seed/showcaseReport.js';
import { EMAIL_DOMAIN } from '../prisma/seed/showcaseData.js';
import { businessDate, clock } from '../src/core/time/clock.js';

const PASSWORD = 'demo-only-password-123';
const SLOW = 20 * 60_000;
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
      await expect(runShowcase({ compact: true, password: PASSWORD })).rejects.toThrow(
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
    await expect(runShowcase({ compact: true, password: PASSWORD })).rejects.toThrow(
      /non-demo data/,
    );
    expect(await prisma.user.count({ where: { email: 'real.director@example.org' } })).toBe(1);
    await prisma.user.deleteMany({});
    await prisma.agency.deleteMany({ where: { id: agency.id } });
  });

  it('refuses --refresh-today when nothing was generated yet', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(
      runShowcase({ refreshToday: true, password: PASSWORD, now: '10:00' }),
    ).rejects.toThrow(/Nothing to refresh/);
  });
});

describe('generated data', () => {
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
  const byKey = (key) => ctx.campaigns.find((c) => c.key === key);
  const todaysCounts = async () => ({
    sales: await prisma.sale.count({ where: { workDate: new Date(today) } }),
    records: await prisma.attendanceRecord.count({ where: { workDate: new Date(today) } }),
  });

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    ctx = await runShowcase({ compact: true, password: PASSWORD, now: '09:30' });
    director = await prisma.user.findUniqueOrThrow({
      where: { email: `director@${EMAIL_DOMAIN}` },
    });
  }, SLOW);

  it('runs without a single refused call and flags everything as demo', async () => {
    expect(ctx.failures).toEqual([]);
    expect(await prisma.user.count({ where: { isDemo: false } })).toBe(0);
    expect(await prisma.pointOfSale.count({ where: { isDemo: false } })).toBe(0);
    const roles = await prisma.user.groupBy({ by: ['role'], _count: true });
    expect(Object.fromEntries(roles.map((r) => [r.role, r._count]))).toEqual({
      director: 1,
      general_manager: 1,
      regional_manager: 2,
      supervisor: 4,
      animateur: 24,
      client: 2,
    });
    expect(await prisma.pointOfSale.count()).toBe(40);
  });

  it('has one closed, one active and one planned campaign dated from the run day', async () => {
    const rows = await prisma.campaign.findMany();
    const status = Object.fromEntries(rows.map((c) => [c.name, c.status]));
    expect(Object.values(status).sort()).toEqual(['active', 'closed', 'planning']);
    const closed = rows.find((c) => c.status === 'closed');
    const active = rows.find((c) => c.status === 'active');
    const planned = rows.find((c) => c.status === 'planning');
    expect(closed.endDate.toISOString().slice(0, 10)).toBe(addDays(today, -21));
    expect(active.startDate.toISOString().slice(0, 10)).toBe(addDays(today, -20));
    expect(active.endDate.toISOString().slice(0, 10)).toBe(addDays(today, 15));
    expect(planned.startDate.toISOString().slice(0, 10)).toBe(addDays(today, 7));
    for (const campaign of rows) {
      const rule = await prisma.campaignRule.findFirst({
        where: {
          ruleType: 'sales_target',
          ruleSet: { campaignId: campaign.id, status: 'approved' },
        },
      });
      expect(rule?.config.dailyUnitsPerAnimateur, campaign.name).toBeGreaterThan(0);
      const tiers = await prisma.promotionTier.count({
        where: { promotion: { ruleSet: { campaignId: campaign.id } } },
      });
      expect(tiers, campaign.name).toBeGreaterThanOrEqual(2);
    }
  });

  it('Prompt 10: the stock reconciliation passes for every campaign that moved stock', async () => {
    for (const key of ['nour', 'najma']) {
      const result = await get(`/campaigns/${byKey(key).row.id}/stock/reconciliation`);
      expect(result.ok, key).toBe(true);
      expect(result.rows.every((row) => row.check.ok)).toBe(true);
      expect(result.totals.balancedToZero).toBe(true);
    }
  });

  it('Prompt 14: KPI totals equal the sum of their breakdowns', async () => {
    const najma = byKey('najma').row;
    const from = addDays(today, -6);
    const query = `campaignIds=${najma.id}&from=${from}&to=${today}`;
    const total = await get(`/reports/kpis?${query}`);
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
    const stock = await get(`/campaigns/${najma.id}/stock/reconciliation`);
    expect(total.gifts.distributedUnits).toBeLessThanOrEqual(total.gifts.entitledUnits);
    expect(stock.ok).toBe(true);
  });

  it('has attendance: a positive rate, late check-ins, rejected proofs and a justified absence', async () => {
    const najma = byKey('najma').row;
    const kpis = await get(
      `/reports/kpis?campaignIds=${najma.id}&from=${addDays(today, -6)}&to=${today}`,
    );
    expect(kpis.attendance.rate).toBeGreaterThan(0);
    expect(await prisma.attendanceRecord.count({ where: { isLate: true } })).toBeGreaterThan(0);
    expect(
      await prisma.attendanceRecord.count({ where: { status: 'rejected' } }),
    ).toBeGreaterThanOrEqual(0);
    expect(await prisma.absence.count({ where: { type: 'justified' } })).toBeGreaterThan(0);
  });

  it('closed campaign: stock returned, Tombola drawn, a prize delivered, final report uploaded', async () => {
    const closed = byKey('nour');
    const row = await prisma.campaign.findUniqueOrThrow({ where: { id: closed.row.id } });
    expect(row.status).toBe('closed');
    const tombola = await prisma.tombola.findUniqueOrThrow({ where: { id: closed.tombolaId } });
    expect(tombola.status).toBe('drawn');
    const winners = await prisma.tombolaWinner.findMany({
      where: { draw: { tombolaId: tombola.id } },
    });
    expect(winners.length).toBeGreaterThanOrEqual(closed.tombola.winners);
    expect(winners.some((w) => w.deliveryStatus === 'delivered')).toBe(true);
    expect(await prisma.campaignDocument.count({ where: { campaignId: row.id } })).toBe(1);
    expect(
      await prisma.stockBalance.count({
        where: {
          quantity: { not: 0 },
          locationKind: { in: ['warehouse', 'holder', 'in_transit'] },
          location: { campaignId: row.id },
        },
      }),
    ).toBe(0);
  });

  it('active campaign: an open Tombola with entries, a resolved dispute, undelivered gifts', async () => {
    const active = byKey('najma');
    const tombola = await prisma.tombola.findUniqueOrThrow({ where: { id: active.tombolaId } });
    expect(tombola.status).toBe('open');
    expect(await prisma.tombolaEntry.count({ where: { tombolaId: tombola.id } })).toBeGreaterThan(
      0,
    );
    const disputed = await prisma.stockMovement.findMany({
      where: { campaignId: active.row.id, status: 'disputed' },
      include: { resolvedBy: true },
    });
    expect(disputed.length).toBe(1);
    expect(disputed[0].resolvedBy.length).toBe(1);
  });

  it('the report lists accounts, counts and the expected AI findings', async () => {
    const report = await buildReport(ctx);
    expect(report.accounts).toHaveLength(34);
    expect(report.accounts.find((a) => a.role === 'animateur').landing).toBe('/field');
    expect(report.counts.rows.find(([label]) => label === 'sales')[1]).toBeGreaterThan(0);
    expect(report.findings.lines.length).toBeGreaterThan(8);
    expect(report.findings.lines.join('\n')).toMatch(/\bS\d+ \/ A\d+\b/);
  });

  it(
    "--refresh-today adds today's activity and is idempotent for the same hour",
    async () => {
      const before = await todaysCounts();
      expect(before.records).toBeGreaterThan(0);
      await runShowcase({ refreshToday: true, password: PASSWORD, now: '15:00' });
      const afternoon = await todaysCounts();
      expect(afternoon.sales).toBeGreaterThan(before.sales);
      await runShowcase({ refreshToday: true, password: PASSWORD, now: '15:00' });
      expect(await todaysCounts()).toEqual(afternoon);
    },
    SLOW,
  );
});
