import { beforeAll, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
import { activateShowcase } from '../../../../prisma/seed/showcaseActivation.js';
import { clock } from '../../../core/time/clock.js';
import { prisma } from '../../../db/client.js';
import {
  createCustomer,
  createGiftEntitlement,
  createPointOfSale,
  createRuleSet,
  createSale,
  day,
  ensureWilaya,
  linkPointOfSale,
} from '../../../db/__tests__/factories.js';
import { attendanceRule, offsetDate } from '../../campaigns/__tests__/fixtures.js';
import { createApp } from '../../../app.js';
import { createStockWorld } from '../../inventory/__tests__/helpers.js';
import { expectedCheckpoints } from '../../attendance/expected.js';

let world;
beforeAll(async () => {
  world = await createStockWorld(createApp());
});

it('counts attendance seeded through the showcase activation and attendance services', async () => {
  const from = offsetDate(-3);
  const to = offsetDate(-2);
  const built = await world.campaign({ startDate: day(from) });
  const { assignment, campaign, pointOfSale } = built;
  const scope = { level: 'agency', agencyId: world.agency.id };
  const rule = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: campaign.id } });
  await prisma.ruleSet.update({
    where: { id: rule.id },
    data: { effectiveFrom: new Date(`${from}T00:00:00+01:00`) },
  });
  await prisma.campaignRule.create({
    data: {
      agencyId: scope.agencyId,
      ruleSetId: rule.id,
      ruleType: 'attendance',
      config: attendanceRule,
    },
  });
  await prisma.assignment.update({
    where: { id: assignment.id },
    data: { workDays: [1, 2, 3, 4, 5, 6, 7] },
  });
  await prisma.campaignStatusHistory.create({
    data: { agencyId: scope.agencyId, campaignId: campaign.id, toStatus: 'draft' },
  });

  await activateShowcase(campaign, world.people.director, from);
  await activateShowcase(campaign, world.people.director, from);
  expect(
    await prisma.campaignStatusHistory.count({
      where: { campaignId: campaign.id, toStatus: 'active' },
    }),
  ).toBe(1);
  for (const date of [from, to]) {
    const slots = await expectedCheckpoints(prisma, scope, campaign, date);
    expect(slots).toMatchObject([
      { assignmentId: assignment.id, checkpoints: [{ code: 'morning' }] },
    ]);
  }

  const photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } })
    .jpeg()
    .toBuffer();
  const now = vi.spyOn(clock, 'now').mockReturnValue(new Date(`${from}T08:45:00+01:00`));
  try {
    const record = await world.ok(
      world
        .call(built.animateurAuth, 'post', `/assignments/${assignment.id}/attendance`)
        .field('checkpoint', 'morning')
        .attach('photo', photo, 'proof.jpg'),
      201,
    );
    const review = await world.ok(
      world.call('supervisor', 'post', `/campaigns/${campaign.id}/attendance/verify-bulk`, {
        ids: [record.id],
      }),
    );
    expect(review).toEqual({ verified: [record.id], skipped: [] });
  } finally {
    now.mockRestore();
  }

  const query = `campaignIds=${campaign.id}&from=${from}&to=${to}`;
  const kpis = await world.ok(world.call('director', 'get', `/reports/kpis?${query}`));
  const stores = await world.ok(
    world.call('director', 'get', `/reports/breakdown?${query}&dimension=point_of_sale`),
  );
  expect(kpis.attendance.rate).toBeGreaterThan(0);
  // One assignment works both days, one morning slot each day, one check-in verified.
  expect(stores.find(({ id }) => id === pointOfSale.id).attendance).toMatchObject({
    expectedSlots: 2,
    verified: 1,
    rate: 1 / 2,
  });
});

it('aggregates campaign KPIs and labels every reporting dimension', async () => {
  const campaign = await world.campaign();
  const filters = `campaignIds=${campaign.id}`;
  const result = await world.call('director', 'get', `/reports/kpis?${filters}`);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  expect(result.body.data).toMatchObject({
    sales: { count: 0, units: 0 },
    customers: { buyers: 0, reach: 0, conversionRate: null },
  });
  for (const dimension of [
    'day',
    'wilaya',
    'region',
    'point_of_sale',
    'supervisor',
    'animateur',
    'product',
    'campaign',
  ]) {
    const response = await world.call(
      'director',
      'get',
      `/reports/breakdown?${filters}&dimension=${dimension}`,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  }
  await world.refused(
    world.call('director', 'get', '/reports/breakdown?dimension=invalid'),
    422,
    'INVALID_DIMENSION',
  );
  await world.refused(
    world.call('supervisorTwo', 'get', `/reports/kpis?${filters}`),
    404,
    'NOT_FOUND',
  );
  const summary = await world.call('director', 'get', `/reports/campaigns/${campaign.id}/summary`);
  expect(summary.status, JSON.stringify(summary.body)).toBe(200);
});

async function workbookFor(actor, path) {
  const response = await world
    .call(actor, 'get', path)
    .set('Accept-Language', 'ar')
    .buffer(true)
    .parse((res, done) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  expect(response.status, response.body.toString()).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.body);
  return workbook;
}

it('round-trips the streamed Arabic workbook with typed values and frozen panes', async () => {
  const campaign = await world.campaign();
  const workbook = await workbookFor('director', `/reports/campaigns/${campaign.id}/export.xlsx`);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    'Summary',
    'By day',
    'By wilaya',
    'By store',
    'By Animateur',
    'Gifts',
    'Visits',
    'Issues',
  ]);
  const summary = workbook.getWorksheet('Summary');
  expect(summary.getRow(1).values).toEqual([undefined, 'Measure', 'Value']);
  expect(summary.views[0]).toMatchObject({ state: 'frozen', rightToLeft: true, ySplit: 1 });
  expect(summary.getCell('B11').value).toBe(0);
  expect(summary.getCell('B8').numFmt).toBe('0.0%');
  expect(summary.getCell('B2').value).toBeInstanceOf(Date);
  expect(summary.autoFilter).toMatch(/^A1:B/);
  expect(summary.getCell('B4').value).toContain('Conversion divides buyers by reach');
  expect(
    await prisma.auditLog.findFirst({
      where: {
        agencyId: world.agency.id,
        action: 'report.exported',
        entityId: campaign.id,
      },
    }),
  ).toMatchObject({ actorId: world.people.director.id, after: { view: 'campaign' } });
});

it('matches BR-34 and module totals through a rule change and a supervisor transfer', async () => {
  const from = offsetDate(-2);
  const to = offsetDate(-1);
  const first = day(from);
  const second = day(to);
  const agency = world.agency;
  const agencyId = agency.id;
  const director = world.people.director.id;
  const supervisor = world.people.supervisor;
  await ensureWilaya(9);
  const setup = async (wilayaId) => {
    const built = await world.campaign({ startDate: first, endDate: second });
    const stores = [built.pointOfSale];
    for (const id of [31, wilayaId]) {
      const store = await createPointOfSale(agencyId, { wilayaId: id });
      await linkPointOfSale(built.campaign, store.id);
      stores.push(store);
    }
    for (const store of [stores[1], stores[2], stores[0]]) {
      await world.extraAnimateur({ ...built, pointOfSale: store });
    }
    const ruleSet = await prisma.ruleSet.findFirstOrThrow({ where: { campaignId: built.id } });
    await prisma.ruleSet.update({ where: { id: ruleSet.id }, data: { effectiveFrom: first } });
    return { ...built, agency, supervisor, ruleSet, client: world.client };
  };
  const [a, b] = [await setup(9), await setup(9)];
  const replacement = await createRuleSet(a.campaign, {
    status: 'approved',
    effectiveFrom: second,
  });
  await prisma.ruleSet.update({ where: { id: a.ruleSet.id }, data: { status: 'superseded' } });
  const savedRule = await createRuleSet(a.campaign, {
    status: 'superseded',
    effectiveFrom: new Date(+second - 3_600_000),
  });
  const newCheckpoints = [
    ...attendanceRule.checkpoints,
    { ...attendanceRule.checkpoints[0], code: 'evening', window: ['16:00', '17:00'] },
  ];
  for (const [rule, checkpoints, dailyUnits] of [
    [a.ruleSet, attendanceRule.checkpoints, 2],
    [replacement, newCheckpoints, 4],
    [
      savedRule,
      [
        ...attendanceRule.checkpoints,
        {
          ...attendanceRule.checkpoints[0],
          code: 'removed',
          window: ['12:00', '13:00'],
        },
      ],
      2,
    ],
    [b.ruleSet, attendanceRule.checkpoints, 2],
  ]) {
    const sample = await prisma.stockItem.create({
      data: {
        agencyId,
        clientId: world.client.id,
        sku: 'SAMPLE-' + rule.id,
        name: 'Sample',
        kind: 'sample',
        unitLabel: 'unit',
      },
    });
    await prisma.campaignRule.createMany({
      data: [
        {
          agencyId,
          ruleSetId: rule.id,
          ruleType: 'attendance',
          config: { ...attendanceRule, checkpoints },
        },
        {
          agencyId,
          ruleSetId: rule.id,
          ruleType: 'sales_target',
          config: { dailyUnitsPerAnimateur: dailyUnits, perProduct: [] },
        },
        {
          agencyId,
          ruleSetId: rule.id,
          ruleType: 'sampling_target',
          config: { dailySamplesPerAnimateur: 1, stockItemId: sample.id },
        },
      ],
    });
  }
  await prisma.reportingLine.createMany({
    data: [
      {
        agencyId,
        userId: supervisor.id,
        managerId: world.people.regional.id,
        validFrom: first,
        validTo: second,
      },
      {
        agencyId,
        userId: supervisor.id,
        managerId: world.people.regionalTwo.id,
        validFrom: second,
      },
    ],
  });
  const attendance = {
    agencyId,
    campaignId: a.id,
    assignmentId: a.assignment.id,
    pointOfSaleId: a.pointOfSale.id,
    animateurId: a.animateur.id,
  };
  await prisma.attendanceRecord.createMany({
    data: [
      {
        ...attendance,
        workDate: first,
        checkpoint: 'morning',
        ruleSetId: a.ruleSet.id,
        recordedAt: first,
        status: 'verified',
        isLate: true,
      },
      {
        ...attendance,
        workDate: second,
        checkpoint: 'morning',
        ruleSetId: replacement.id,
        recordedAt: second,
        status: 'pending',
        isLate: false,
      },
      {
        ...attendance,
        workDate: second,
        checkpoint: 'removed',
        ruleSetId: savedRule.id,
        recordedAt: second,
        status: 'verified',
        isLate: false,
      },
    ],
  });
  const excused = await prisma.assignment.findFirstOrThrow({
    where: { campaignId: a.id, id: { not: a.assignment.id } },
  });
  await prisma.absence.create({
    data: {
      agencyId,
      assignmentId: excused.id,
      animateurId: excused.animateurId,
      workDate: first,
      type: 'justified',
      reason: 'Approved absence',
      recordedById: director,
    },
  });
  const buyer = await createCustomer(a, { fullName: 'Private buyer' });
  async function sell(workDate, quantity, customerId, voided = false) {
    return createSale(a, {
      assignmentId: a.assignment.id,
      workDate,
      soldAt: workDate,
      customerId,
      ...(voided
        ? { status: 'voided', voidedAt: second, voidedById: director, voidReason: 'Duplicate' }
        : {}),
      items: { create: { agencyId, productId: a.product.id, quantity } },
    });
  }
  const sold = await sell(first, 3, buyer.id);
  await sell(second, 2, buyer.id);
  await sell(second, 1, null);
  const voided = await sell(second, 12, null, true);
  const [undelivered, reviewed] = await Promise.all([
    createGiftEntitlement(a, sold),
    createGiftEntitlement(a, voided),
  ]);
  await prisma.giftEntitlement.update({
    where: { id: undelivered.id },
    data: { status: 'undelivered', quantity: 3 },
  });
  await prisma.giftEntitlement.update({
    where: { id: reviewed.id },
    data: { status: 'distributed' },
  });
  await world.stockIn(a, [{ stockItemId: undelivered.stockItemId, quantity: 8 }]);
  await prisma.fieldInteraction.create({
    data: { ...attendance, workDate: first, kind: 'sample', count: 3, createdById: a.animateur.id },
  });
  const visit = await prisma.supervisorVisit.create({
    data: {
      agencyId,
      campaignId: a.id,
      pointOfSaleId: a.pointOfSale.id,
      supervisorId: supervisor.id,
      visitedAt: first,
      observedAnimateurIds: [a.animateur.id],
    },
  });

  const filters = `campaignIds=${a.id},${b.id}&from=${from}&to=${to}`;
  const kpis = (actor, query = filters) =>
    world.ok(world.call(actor, 'get', '/reports/kpis?' + query));
  const all = await kpis('director');
  // Twenty planned checkpoints less one excused slot. 2 × 16 staff-days plus 2 × 4 changed targets.
  expect(all).toMatchObject({
    attendance: {
      expectedSlots: 19,
      verified: 2,
      pending: 1,
      notSent: 17,
      lateShare: 1 / 3,
      rate: 1 / 19,
      submittedRate: 2 / 19,
    },
    sales: { count: 3, units: 6 },
    customers: { buyers: 2, reach: 5, conversionRate: 2 / 5 },
    gifts: {
      entitledUnits: 3,
      distributedUnits: 0,
      undeliveredUnits: 3,
      toReview: 1,
      distributionRate: 0,
    },
    visits: { count: 1, assignedStores: 6, storeCoverage: 1 / 6 },
    completion: {
      plannedDays: 4,
      elapsedDays: 4,
      salesTarget: 40,
      samplingTarget: 16,
      targetAchievement: 6 / 40,
      samplingTargetAchievement: 3 / 16,
    },
    stock: {
      stockIn: 8,
      customers: 0,
      losses: 0,
      physical: 8,
      returnedToClient: 0,
      failingChecks: 0,
    },
  });
  expect((await kpis('regional')).sales.units).toBe(3);
  const afterTransfer = await kpis('regional', `campaignIds=${a.id},${b.id}&from=${to}&to=${to}`);
  expect(afterTransfer.sales.units).toBe(0);
  expect(afterTransfer.completion.plannedDays).toBe(0);
  expect((await kpis('regionalTwo')).sales.units).toBe(3);
  expect((await kpis('supervisor')).sales.units).toBe(6);
  expect(
    (await kpis(a.animateurAuth, `campaignIds=${a.id}&from=${from}&to=${to}`)).sales.units,
  ).toBe(6);
  expect((await kpis('director', filters + '&wilayaIds=31')).sales.units).toBe(0);
  const firstDay = await kpis('director', `campaignIds=${a.id},${b.id}&from=${from}&to=${from}`);
  expect(firstDay.completion).toMatchObject({
    plannedDays: 4,
    elapsedDays: 2,
    rate: 0.5,
    salesTarget: 16,
  });
  await world.refused(
    world.call('clientUser', 'get', '/reports/kpis?' + filters),
    404,
    'NOT_FOUND',
  );
  await world.refused(
    world.call(a.animateurAuth, 'get', '/reports/export.xlsx?' + filters),
    403,
    'FORBIDDEN',
  );
  const sales = await world.call(
    'director',
    'get',
    `/campaigns/${a.id}/sales?from=${from}&to=${to}`,
  );
  expect(sales.body.meta.counts).toMatchObject({
    units: all.sales.units,
    sales: all.sales.count,
    buyers: all.customers.buyers,
    undelivered: all.gifts.undeliveredUnits,
  });
  const boards = await Promise.all(
    [a, b].flatMap(({ id }) =>
      [from, to].map((date) =>
        world.ok(world.call('director', 'get', `/campaigns/${id}/attendance/board?date=${date}`)),
      ),
    ),
  );
  for (const [key, tally] of [
    ['verified', 'verified'],
    ['pending', 'pending'],
    ['notSent', 'not_sent'],
    ['absentJustified', 'absent_justified'],
  ]) {
    expect(all.attendance[key]).toBe(boards.reduce((sum, row) => sum + row.counters[tally], 0));
  }
  const stock = await world.ok(
    world.call('director', 'get', `/campaigns/${a.id}/stock/reconciliation`),
  );
  expect(all.stock).toMatchObject(stock.totals.all);
  const book = await workbookFor('director', '/reports/export.xlsx?' + filters);
  const cells = JSON.stringify(book.worksheets.flatMap((sheet) => sheet.getSheetValues()));
  expect(cells).not.toMatch(/Private buyer|Customer (name|phone)/i);
  expect(book.getWorksheet('Summary').getCell('B11').value).toBe(6);

  const other = await world.extraAnimateur(a, world.people.supervisorTwo.id);
  await prisma.supervisorVisit.update({
    where: { id: visit.id },
    data: { observedAnimateurIds: [a.animateur.id, other.animateur.id] },
  });
  const byAnimateur = await world.ok(
    world.call('supervisor', 'get', '/reports/breakdown?dimension=animateur&' + filters),
  );
  expect(byAnimateur.map(({ id }) => id)).not.toContain(other.animateur.id);
  expect(byAnimateur.find(({ id }) => id === a.animateur.id).visits.count).toBe(1);

  const restrictedStore = await prisma.pointOfSale.findFirstOrThrow({
    where: { wilayaId: 31, campaignPointsOfSale: { some: { campaignId: a.id } } },
  });
  await prisma.issue.create({
    data: {
      agencyId,
      campaignId: a.id,
      pointOfSaleId: restrictedStore.id,
      assignmentId: a.assignment.id,
      reportedById: director,
      title: 'Restricted issue',
      category: 'equipment',
      createdAt: first,
    },
  });
  const supervisorBook = await workbookFor('supervisor', '/reports/export.xlsx?' + filters);
  expect(supervisorBook.getWorksheet('Issues').rowCount).toBe(1);
});
