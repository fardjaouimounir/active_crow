import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POLYGON_WILAYAS, WILAYA_POLYGON } from '@fieldflow/shared/wilayaPolygons';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import {
  createPointOfSale,
  day,
  ensureWilaya,
  linkPointOfSale,
} from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { addRules, addSale } from '../../ai/__tests__/helpers.js';
import { createStockWorld } from '../../inventory/__tests__/helpers.js';

const app = createApp();
let world;
beforeAll(async () => {
  world = await createStockWorld(app);
});

const web = (...parts) => join(import.meta.dirname, '../../../../../web', ...parts);

describe('wilaya to polygon mapping', () => {
  it('covers all 69 wilayas with a polygon that exists in the committed boundary file', () => {
    const wilayas = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../prisma/seed/data/wilayas.json'), 'utf8'),
    );
    const geo = JSON.parse(readFileSync(web('src/assets/geo/dz-wilayas.json'), 'utf8'));
    const polygons = new Set(geo.features.map((feature) => feature.properties.code));
    expect(wilayas).toHaveLength(69);
    for (const { id } of wilayas) {
      expect(WILAYA_POLYGON[id], `wilaya ${id} has a polygon code`).toBeDefined();
      expect(polygons.has(WILAYA_POLYGON[id]), `polygon ${WILAYA_POLYGON[id]} exists`).toBe(true);
    }
    // The first 48 own their polygon; the 21 newer ones are folded into a parent.
    expect(geo.features).toHaveLength(48);
    expect(Object.values(POLYGON_WILAYAS).flat()).toHaveLength(69);
    expect(Object.values(POLYGON_WILAYAS).filter((ids) => ids.length > 1)).not.toHaveLength(0);
  });
});

/** A store with an approved assignment and one recorded sale of `units`. */
async function storeWithSale(built, ruleSet, units, place = {}, workDate = undefined) {
  const store = await createPointOfSale(world.agency.id, place);
  await linkPointOfSale(built.campaign, store.id);
  const extra = await world.extraAnimateur({ ...built, pointOfSale: store });
  const assignment = await prisma.assignment.findFirstOrThrow({
    where: { campaignId: built.id, animateurId: extra.animateur.id },
  });
  const sale = await addSale(
    world,
    { ...built, pointOfSale: store, animateur: extra.animateur, assignment },
    ruleSet,
    units,
    1,
  );
  if (workDate) await prisma.sale.update({ where: { id: sale.id }, data: workDate });
  return { store, sale, ...extra };
}

describe('geo endpoints', () => {
  it('colours wilayas and polygons with the same numbers as the KPIs and lists included wilayas', async () => {
    await Promise.all([1, 49, 50].map(ensureWilaya));
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await addSale(world, built, ruleSet, 7, 1);
    await storeWithSale(built, ruleSet, 3, { wilayaId: 1 });
    await storeWithSale(built, ruleSet, 5, { wilayaId: 49 });
    const filters = `campaignIds=${built.id}`;
    const kpis = await world.ok(world.call('director', 'get', `/reports/kpis?${filters}`));
    const geo = await world.ok(
      world.call('director', 'get', `/reports/geo/wilayas?${filters}&metric=sales_units`),
    );
    const sum = (rows) => rows.reduce((total, row) => total + row.value, 0);
    expect(kpis.sales.units).toBe(15);
    expect(geo.total.value).toBe(15);
    expect(sum(geo.wilayas)).toBe(15);
    expect(sum(geo.polygons)).toBe(15);
    // Wilaya 49 (Timimoun) has no polygon: it is drawn inside Adrar (01) with wilaya 1.
    const adrar = geo.polygons.find(({ polygonCode }) => polygonCode === '01');
    expect(adrar.value).toBe(8);
    expect(adrar.wilayaIds).toEqual(expect.arrayContaining([1, 49, 50]));
    expect(adrar.included.map(({ id }) => id).sort((a, b) => a - b)).toEqual([49, 50]);
    expect(geo.wilayas.find(({ wilayaId }) => wilayaId === 49)).toMatchObject({
      code: '49',
      polygonCode: '01',
      value: 5,
    });
    expect(geo.polygons.map(({ rank }) => rank).sort()).toEqual([1, 2]);
    expect(geo.polygons.find(({ rank }) => rank === 1).value).toBe(8);
    // Every metric answers and ratios are recomputed from totals, not averaged.
    for (const metric of [
      'buyers',
      'conversion_rate',
      'attendance_rate',
      'gift_distribution_rate',
      'store_coverage',
      'undelivered_units',
    ]) {
      const response = await world.call(
        'director',
        'get',
        `/reports/geo/wilayas?${filters}&metric=${metric}`,
      );
      expect(response.status, metric).toBe(200);
    }
    await world.refused(
      world.call('director', 'get', `/reports/geo/wilayas?${filters}&metric=revenue`),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('is scoped like the dashboard: other supervisors and clients get 404', async () => {
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await addSale(world, built, ruleSet, 2, 1);
    const filters = `campaignIds=${built.id}`;
    for (const path of ['geo/wilayas', 'geo/stores', 'heatmap?kind=sales&']) {
      const url = `/reports/${path}${path.includes('?') ? '' : '?'}${filters}`;
      await world.refused(world.call('supervisorTwo', 'get', url), 404, 'NOT_FOUND');
      await world.refused(world.call('clientUser', 'get', url), 404, 'NOT_FOUND');
      const own = await world.call('supervisor', 'get', url);
      expect(own.status, url).toBe(200);
    }
  });

  it('lists stores with coordinates and keeps stores without coordinates apart', async () => {
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await prisma.pointOfSale.update({
      where: { id: built.pointOfSale.id },
      data: { latitude: 36.7538, longitude: 3.0588 },
    });
    await addSale(world, built, ruleSet, 4, 1);
    const lost = await storeWithSale(built, ruleSet, 1, { wilayaId: 16 });
    await prisma.supervisorVisit.create({
      data: {
        agencyId: world.agency.id,
        campaignId: built.id,
        pointOfSaleId: built.pointOfSale.id,
        supervisorId: world.people.supervisor.id,
        visitedAt: new Date(),
        observedAnimateurIds: [built.animateur.id],
      },
    });
    await prisma.issue.create({
      data: {
        agencyId: world.agency.id,
        campaignId: built.id,
        pointOfSaleId: built.pointOfSale.id,
        category: 'pos_problem',
        title: 'Shelf empty',
        description: 'No stock on the shelf',
        reportedById: world.people.supervisor.id,
        status: 'open',
      },
    });
    const response = await world.ok(
      world.call('director', 'get', `/reports/geo/stores?campaignIds=${built.id}`),
    );
    const located = response.stores.find(({ id }) => id === built.pointOfSale.id);
    expect(located).toMatchObject({
      latitude: 36.7538,
      longitude: 3.0588,
      salesUnits: 4,
      openIssues: 1,
      lastVisit: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    // Today's attendance: one Animateur working today, nothing sent yet.
    expect(located.today).toMatchObject({
      animateurs: 1,
      notSent: 1,
      present: 0,
      late: 0,
      absent: 0,
    });
    expect(response.stores.every((store) => store.latitude != null)).toBe(true);
    expect(response.unlocated.map(({ id }) => id)).toContain(lost.store.id);
    expect(response.stores.map(({ id }) => id)).not.toContain(lost.store.id);
    // Nothing is ever placed at 0,0 and no person is named.
    expect(JSON.stringify(response)).not.toMatch(/fullName/);
  });

  it("limits visits and today's attendance to what the role may see (data-level scope)", async () => {
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await addSale(world, built, ruleSet, 1, 1);
    await prisma.pointOfSale.update({
      where: { id: built.pointOfSale.id },
      data: { latitude: 36.7538, longitude: 3.0588 },
    });
    // A second Animateur at the same store, supervised by someone else.
    await world.extraAnimateur(built, world.people.supervisorTwo.id);
    const noon = (daysAgo) => {
      const at = new Date();
      at.setUTCHours(12, 0, 0, 0);
      return new Date(at.getTime() - daysAgo * 86_400_000);
    };
    const visit = (supervisorId, visitedAt) =>
      prisma.supervisorVisit.create({
        data: {
          agencyId: world.agency.id,
          campaignId: built.id,
          pointOfSaleId: built.pointOfSale.id,
          supervisorId,
          visitedAt,
          observedAnimateurIds: [built.animateur.id],
        },
      });
    await visit(world.people.supervisor.id, noon(3));
    await visit(world.people.supervisorTwo.id, noon(0));
    const url = `/reports/geo/stores?campaignIds=${built.id}`;
    const find = (data) => data.stores.find(({ id }) => id === built.pointOfSale.id);
    const director = find(await world.ok(world.call('director', 'get', url)));
    const supervisor = find(await world.ok(world.call('supervisor', 'get', url)));
    // The director sees both Animateurs and the latest visit; the supervisor only their own.
    expect(director.today.animateurs).toBe(2);
    expect(director.lastVisit).toBe(noon(0).toISOString().slice(0, 10));
    expect(supervisor.today.animateurs).toBe(1);
    expect(supervisor.lastVisit).toBe(noon(3).toISOString().slice(0, 10));
    // The heatmap and the wilaya map obey the same scope.
    const heat = await world.ok(
      world.call('supervisor', 'get', `/reports/heatmap?kind=sales&campaignIds=${built.id}`),
    );
    expect(heat.total).toBe(1);
  });

  it('never plots a missing or impossible location', async () => {
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await addSale(world, built, ruleSet, 1, 1);
    await prisma.pointOfSale.update({
      where: { id: built.pointOfSale.id },
      data: { latitude: 0, longitude: 0 },
    });
    const response = await world.ok(
      world.call('director', 'get', `/reports/geo/stores?campaignIds=${built.id}`),
    );
    expect(response.stores.map(({ id }) => id)).not.toContain(built.pointOfSale.id);
    expect(response.unlocated.map(({ id }) => id)).toContain(built.pointOfSale.id);
  });

  it('buckets the heatmap by ISO weekday and Algiers hour across midnight', async () => {
    const built = await world.campaign({
      startDate: day('2026-11-09'),
      endDate: day('2026-11-30'),
    });
    const ruleSet = await addRules(world, built);
    const base = {
      agencyId: world.agency.id,
      campaignId: built.id,
      assignmentId: built.assignment.id,
      pointOfSaleId: built.pointOfSale.id,
      animateurId: built.animateur.id,
      supervisorId: world.people.supervisor.id,
      ruleSetId: ruleSet.id,
    };
    // 22:30 UTC = 23:30 in Algiers on Monday 2026-11-16; 23:30 UTC = 00:30 on Tuesday the 17th.
    for (const [soldAt, workDate] of [
      ['2026-11-16T22:30:00Z', '2026-11-16'],
      ['2026-11-16T22:45:00Z', '2026-11-16'],
      ['2026-11-16T23:30:00Z', '2026-11-17'],
    ]) {
      await prisma.sale.create({
        data: { ...base, soldAt: new Date(soldAt), workDate: day(workDate) },
      });
    }
    const result = await world.ok(
      world.call(
        'director',
        'get',
        `/reports/heatmap?kind=sales&campaignIds=${built.id}&from=2026-11-16&to=2026-11-17`,
      ),
    );
    expect(result.matrix).toHaveLength(7);
    expect(result.matrix.every((row) => row.length === 24)).toBe(true);
    expect(result.matrix[0][23]).toBe(2); // Monday 23:00
    expect(result.matrix[1][0]).toBe(1); // Tuesday 00:00
    expect(result.total).toBe(3);
    expect(result.max).toBe(2);
    // The same three sales are the KPI total for the same filters.
    const kpis = await world.ok(
      world.call(
        'director',
        'get',
        `/reports/kpis?campaignIds=${built.id}&from=2026-11-16&to=2026-11-17`,
      ),
    );
    expect(kpis.sales.count).toBe(result.total);
    await prisma.attendanceRecord.create({
      data: {
        agencyId: world.agency.id,
        campaignId: built.id,
        assignmentId: built.assignment.id,
        pointOfSaleId: built.pointOfSale.id,
        animateurId: built.animateur.id,
        workDate: day('2026-11-18'),
        checkpoint: 'morning',
        ruleSetId: ruleSet.id,
        recordedAt: new Date('2026-11-18T08:20:00Z'), // 09:20 Algiers, Wednesday
        status: 'pending',
        isLate: true,
      },
    });
    const late = await world.ok(
      world.call(
        'director',
        'get',
        `/reports/heatmap?kind=attendance_late&campaignIds=${built.id}&from=2026-11-16&to=2026-11-20`,
      ),
    );
    expect(late.matrix[2][9]).toBe(1);
    await world.refused(
      world.call('director', 'get', '/reports/heatmap?kind=nothing'),
      400,
      'VALIDATION_FAILED',
    );
  });
});

describe('portal geo (client view)', () => {
  it('shows wilayas and stores to the client without attendance, visits, issues or staff', async () => {
    const built = await world.campaign();
    const ruleSet = await addRules(world, built);
    await prisma.pointOfSale.update({
      where: { id: built.pointOfSale.id },
      data: { latitude: 36.7538, longitude: 3.0588 },
    });
    await addSale(world, built, ruleSet, 6, 1);
    const wilayas = await world.ok(
      world.call('clientUser', 'get', `/portal/campaigns/${built.id}/geo/wilayas`),
    );
    expect(wilayas.total.value).toBe(6);
    expect(Object.keys(wilayas.polygons[0].kpis).sort()).toEqual([
      'buyers',
      'conversionRate',
      'giftDistributionRate',
      'salesUnits',
    ]);
    const stores = await world.ok(
      world.call('clientUser', 'get', `/portal/campaigns/${built.id}/geo/stores`),
    );
    expect(stores.stores).toHaveLength(1);
    expect(Object.keys(stores.stores[0]).sort()).toEqual([
      'buyers',
      'id',
      'latitude',
      'longitude',
      'name',
      'salesUnits',
      'wilaya',
    ]);
    // Staff-only metrics are refused, and another company's campaign is invisible.
    await world.refused(
      world.call(
        'clientUser',
        'get',
        `/portal/campaigns/${built.id}/geo/wilayas?metric=attendance_rate`,
      ),
      400,
      'VALIDATION_FAILED',
    );
    await world.refused(
      world.call('supervisor', 'get', `/portal/campaigns/${built.id}/geo/stores`),
      404,
      'NOT_FOUND',
    );
  });
});
