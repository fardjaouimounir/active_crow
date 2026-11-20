import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../../../../prisma/seed/demo.js';
import { createApp } from '../../../app.js';
import { businessDate } from '../../../core/time/clock.js';
import {
  createAgency,
  createClient,
  createPointOfSale,
  createProduct,
  createUser,
  day,
  ensureWilaya,
} from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';

const app = createApp();
const root = '/api/v1';
const auth = {};
const people = {};
const points = {};
const products = {};
let agency;
let otherAgency;
let clientX;
let clientY;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\n%%EOF\n');
const future = (days) => {
  const date = new Date(businessDate() + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

function send(method, path, actor = 'director', body) {
  const req = request(app)[method](root + path);
  if (actor) req.set(auth[actor]);
  return body === undefined ? req : req.send(body);
}

async function ok(req, status) {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body.data;
}

async function rejected(req, status, code) {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(res.body.error.code).toBe(code);
  return res.body.error.details;
}

const draft = (overrides = {}) => ({
  clientId: clientX.id,
  name: 'Ramadan — ' + randomUUID().slice(0, 8),
  startDate: future(10),
  endDate: future(40),
  budgetAmount: '2500000.00',
  ...overrides,
});
const createCampaign = (overrides, actor = 'director') =>
  ok(send('post', '/campaigns', actor, draft(overrides)), 201);
const setWilayas = (id, wilayas) =>
  send('put', '/campaigns/' + id + '/wilayas', 'director', { wilayas });
const addStaff = (id, user, wilayaId, role = user.role) =>
  send('post', '/campaigns/' + id + '/staff', 'director', { userId: user.id, wilayaId, role });

function assignment(campaignId, data) {
  return prisma.assignment.create({
    data: {
      agencyId: agency.id,
      campaignId,
      animateurId: people.animateur.id,
      supervisorId: people.supervisor.id,
      proposedById: people.director.id,
      startDate: day(future(12)),
      endDate: day(future(20)),
      status: 'approved',
      ...data,
    },
  });
}

beforeAll(async () => {
  await Promise.all([9, 16, 31].map(ensureWilaya));
  agency = await createAgency();
  otherAgency = await createAgency();
  clientX = await createClient(agency.id, { name: 'Client X' });
  clientY = await createClient(agency.id, { name: 'Client Y' });
  for (const [name, data] of Object.entries({
    director: { role: 'director' },
    general: { role: 'general_manager' },
    regional: { role: 'regional_manager' },
    regionalTwo: { role: 'regional_manager' },
    supervisor: { role: 'supervisor' },
    supervisorTwo: { role: 'supervisor' },
    animateur: { role: 'animateur' },
    clientUser: { role: 'client', clientId: clientX.id },
  })) {
    people[name] = await createUserWithPassword(agency.id, data);
    auth[name] = bearer((await login(app, people[name])).accessToken);
  }
  points.a16 = await createPointOfSale(agency.id, { wilayaId: 16 });
  points.b16 = await createPointOfSale(agency.id, { wilayaId: 16 });
  points.c31 = await createPointOfSale(agency.id, { wilayaId: 31 });
  points.d9 = await createPointOfSale(agency.id, { wilayaId: 9 });
  points.deleted = await createPointOfSale(agency.id, { wilayaId: 16, deletedAt: new Date() });
  products.x1 = await createProduct(agency.id, clientX.id);
  products.x2 = await createProduct(agency.id, clientX.id);
  products.deleted = await createProduct(agency.id, clientX.id, { deletedAt: new Date() });
  products.y1 = await createProduct(agency.id, clientY.id);
});

describe('FR-030 create a draft campaign', () => {
  it('creates the campaign with its code, history, five stock locations and rule set v1', async () => {
    const campaign = await createCampaign({ assignmentApproverRole: 'general_manager' });
    const year = campaign.startDate.slice(0, 4);
    expect(campaign).toMatchObject({
      code: expect.stringMatching(new RegExp('^CMP-' + year + '-\\d{3}$')),
      status: 'draft',
      version: 1,
      budgetAmount: '2500000.00',
      assignmentApproverRole: 'general_manager',
      client: { id: clientX.id, name: 'Client X' },
      counts: { wilayas: 0, requiredAnimateurs: 0, staff: 0, pointsOfSale: 0, documents: 0 },
    });
    const locations = await prisma.stockLocation.findMany({ where: { campaignId: campaign.id } });
    expect(locations.map((row) => row.kind).sort()).toEqual(
      ['customers', 'external', 'in_transit', 'losses', 'warehouse'].sort(),
    );
    expect(locations.every((row) => row.userId === null)).toBe(true);
    const ruleSets = await prisma.ruleSet.findMany({ where: { campaignId: campaign.id } });
    expect(ruleSets).toEqual([expect.objectContaining({ version: 1, status: 'draft' })]);
    const history = await ok(send('get', '/campaigns/' + campaign.id + '/status-history'), 200);
    expect(history).toEqual([
      expect.objectContaining({
        fromStatus: null,
        toStatus: 'draft',
        changedBy: { id: people.director.id, fullName: people.director.fullName },
      }),
    ]);
    expect(
      await prisma.auditLog.count({ where: { entityId: campaign.id, action: 'campaign.created' } }),
    ).toBe(1);
  });

  it('numbers codes per agency and year, without duplicates under concurrency', async () => {
    const year = Number(future(10).slice(0, 4)) + 2;
    const start = year + '-03-01';
    const [first, second] = await Promise.all([
      createCampaign({ startDate: start, endDate: year + '-03-31' }),
      createCampaign({ startDate: start, endDate: year + '-03-31' }),
    ]);
    expect([first.code, second.code].sort()).toEqual([
      'CMP-' + year + '-001',
      'CMP-' + year + '-002',
    ]);
    const third = await createCampaign({ startDate: start, endDate: year + '-04-30' });
    expect(third.code).toBe('CMP-' + year + '-003');
    const next = await createCampaign({
      startDate: year + 1 + '-01-10',
      endDate: year + 1 + '-02-10',
    });
    expect(next.code).toBe('CMP-' + (year + 1) + '-001');
  });

  it('validates dates, client, money and approver role', async () => {
    const yesterday = new Date(businessDate() + 'T00:00:00.000Z');
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const past = yesterday.toISOString().slice(0, 10);
    await rejected(
      send('post', '/campaigns', 'director', draft({ startDate: past })),
      422,
      'CAMPAIGN_START_IN_PAST',
    );
    await ok(send('post', '/campaigns', 'director', draft({ startDate: businessDate() })), 201);
    await rejected(
      send('post', '/campaigns', 'director', draft({ endDate: future(5) })),
      400,
      'VALIDATION_FAILED',
    );
    const deleted = await createClient(agency.id, { deletedAt: new Date() });
    const foreign = await createClient(otherAgency.id);
    for (const clientId of [deleted.id, foreign.id]) {
      await rejected(
        send('post', '/campaigns', 'director', draft({ clientId })),
        422,
        'CLIENT_INACTIVE',
      );
    }
    for (const body of [
      draft({ budgetAmount: 2500000 }),
      draft({ budgetAmount: '1.555' }),
      draft({ assignmentApproverRole: 'supervisor' }),
      draft({ status: 'active' }),
      draft({ startDate: '2027-02-30' }),
    ]) {
      await rejected(send('post', '/campaigns', 'director', body), 400, 'VALIDATION_FAILED');
    }
    await rejected(send('post', '/campaigns', 'general', draft()), 403, 'FORBIDDEN');
  });
});

describe('update', () => {
  it('uses optimistic versions and never changes the client', async () => {
    const campaign = await createCampaign();
    const path = '/campaigns/' + campaign.id;
    const updated = await ok(
      send('patch', path, 'director', { version: 1, name: 'Renamed', budgetAmount: null }),
      200,
    );
    expect(updated).toMatchObject({ name: 'Renamed', budgetAmount: null, version: 2 });
    await rejected(
      send('patch', path, 'director', { version: 1, name: 'Stale' }),
      409,
      'VERSION_CONFLICT',
    );
    await rejected(
      send('patch', path, 'director', { version: 2, clientId: clientY.id }),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(
      send('patch', path, 'director', { version: 2, endDate: future(5) }),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(send('patch', path, 'director', { version: 2 }), 400, 'VALIDATION_FAILED');
  });
});

describe('FR-031 coverage', () => {
  it('replaces wilayas and refuses to remove one that still has staff or points of sale', async () => {
    const campaign = await createCampaign();
    const after = await ok(
      setWilayas(campaign.id, [
        { wilayaId: 16, requiredAnimateurs: 3 },
        { wilayaId: 31, requiredAnimateurs: 2 },
      ]),
      200,
    );
    expect(after.counts).toMatchObject({ wilayas: 2, requiredAnimateurs: 5 });
    await rejected(
      setWilayas(campaign.id, [
        { wilayaId: 16, requiredAnimateurs: 1 },
        { wilayaId: 16, requiredAnimateurs: 2 },
      ]),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(
      setWilayas(campaign.id, [{ wilayaId: 16, requiredAnimateurs: 501 }]),
      400,
      'VALIDATION_FAILED',
    );
    await ok(addStaff(campaign.id, people.supervisor, 16), 201);
    await ok(
      send('put', '/campaigns/' + campaign.id + '/points-of-sale', 'director', {
        pointOfSaleIds: [points.c31.id],
      }),
      200,
    );
    const details = await rejected(setWilayas(campaign.id, []), 422, 'WILAYA_IN_USE');
    expect(details.wilayas).toEqual([
      { wilayaId: 16, staff: 1, pointsOfSale: 0 },
      { wilayaId: 31, staff: 0, pointsOfSale: 1 },
    ]);
    const kept = await ok(
      setWilayas(campaign.id, [
        { wilayaId: 16, requiredAnimateurs: 4 },
        { wilayaId: 31, requiredAnimateurs: 0 },
        { wilayaId: 9, requiredAnimateurs: 1 },
      ]),
      200,
    );
    expect(kept.wilayas.map((row) => [row.wilayaId, row.requiredAnimateurs])).toEqual([
      [9, 1],
      [16, 4],
      [31, 0],
    ]);
  });

  it('staffs wilayas with one regional manager each and matching account roles', async () => {
    const campaign = await createCampaign();
    await ok(
      setWilayas(campaign.id, [
        { wilayaId: 16, requiredAnimateurs: 1 },
        { wilayaId: 31, requiredAnimateurs: 1 },
      ]),
      200,
    );
    await rejected(addStaff(campaign.id, people.supervisor, 9), 422, 'WILAYA_NOT_IN_CAMPAIGN');
    await rejected(
      addStaff(campaign.id, people.supervisor, 16, 'regional_manager'),
      422,
      'STAFF_ROLE_MISMATCH',
    );
    await rejected(
      send('post', '/campaigns/' + campaign.id + '/staff', 'director', {
        userId: people.animateur.id,
        wilayaId: 16,
        role: 'animateur',
      }),
      400,
      'VALIDATION_FAILED',
    );
    const regional = await ok(addStaff(campaign.id, people.regional, 16), 201);
    expect(regional).toMatchObject({ role: 'regional_manager', wilayaId: 16 });
    await rejected(
      addStaff(campaign.id, people.regionalTwo, 16),
      422,
      'WILAYA_ALREADY_HAS_REGIONAL',
    );
    await ok(addStaff(campaign.id, people.regionalTwo, 31), 201);
    await ok(addStaff(campaign.id, people.supervisor, 16), 201);
    await ok(addStaff(campaign.id, people.supervisor, 31), 201);
    await rejected(addStaff(campaign.id, people.supervisor, 31), 409, 'CONFLICT');
    const suspended = await createUser(agency.id, { role: 'supervisor', status: 'suspended' });
    await rejected(addStaff(campaign.id, suspended, 16), 422, 'USER_INACTIVE');
    const outsider = await createUser(otherAgency.id, { role: 'supervisor' });
    await rejected(addStaff(campaign.id, outsider, 16), 404, 'NOT_FOUND');
    const detail = await ok(send('get', '/campaigns/' + campaign.id), 200);
    expect(detail.counts.staff).toBe(4);
  });

  it('refuses to remove a supervisor of proposed or approved assignments', async () => {
    const campaign = await createCampaign();
    await ok(setWilayas(campaign.id, [{ wilayaId: 16, requiredAnimateurs: 1 }]), 200);
    const staff = await ok(addStaff(campaign.id, people.supervisor, 16), 201);
    await ok(
      send('put', '/campaigns/' + campaign.id + '/points-of-sale', 'director', {
        pointOfSaleIds: [points.a16.id],
      }),
      200,
    );
    const busy = await assignment(campaign.id, {
      pointOfSaleId: points.a16.id,
      status: 'proposed',
    });
    const path = '/campaigns/' + campaign.id + '/staff/' + staff.id;
    await rejected(send('delete', path), 422, 'STAFF_HAS_ASSIGNMENTS');
    await prisma.assignment.update({ where: { id: busy.id }, data: { status: 'cancelled' } });
    await ok(send('delete', path), 204);
    await rejected(send('delete', path), 404, 'NOT_FOUND');
  });

  it('links active points of sale of the campaign wilayas only', async () => {
    const campaign = await createCampaign();
    const path = '/campaigns/' + campaign.id + '/points-of-sale';
    await ok(setWilayas(campaign.id, [{ wilayaId: 16, requiredAnimateurs: 1 }]), 200);
    const outside = await rejected(
      send('put', path, 'director', { pointOfSaleIds: [points.a16.id, points.d9.id] }),
      422,
      'POS_OUTSIDE_CAMPAIGN_WILAYAS',
    );
    expect(outside.pointOfSaleIds).toEqual([points.d9.id]);
    await rejected(
      send('put', path, 'director', { pointOfSaleIds: [points.deleted.id] }),
      422,
      'POS_OUTSIDE_CAMPAIGN_WILAYAS',
    );
    await rejected(
      send('put', path, 'director', { pointOfSaleIds: [points.a16.id, points.a16.id] }),
      400,
      'VALIDATION_FAILED',
    );
    const linked = await ok(
      send('put', path, 'director', { pointOfSaleIds: [points.a16.id, points.b16.id] }),
      200,
    );
    expect(linked.pointsOfSale.map(({ id }) => id).sort()).toEqual(
      [points.a16.id, points.b16.id].sort(),
    );
    await assignment(campaign.id, { pointOfSaleId: points.a16.id });
    const busy = await rejected(
      send('put', path, 'director', { pointOfSaleIds: [points.b16.id] }),
      422,
      'POS_HAS_ASSIGNMENTS',
    );
    expect(busy.pointOfSaleIds).toEqual([points.a16.id]);
    await ok(send('put', path, 'director', { pointOfSaleIds: [points.a16.id] }), 200);
  });

  it("links only active products of the campaign's client", async () => {
    const campaign = await createCampaign();
    const path = '/campaigns/' + campaign.id + '/products';
    for (const productId of [products.y1.id, products.deleted.id]) {
      const details = await rejected(
        send('put', path, 'director', { productIds: [products.x1.id, productId] }),
        422,
        'PRODUCT_NOT_OF_CLIENT',
      );
      expect(details.productIds).toEqual([productId]);
    }
    const linked = await ok(
      send('put', path, 'director', { productIds: [products.x1.id, products.x2.id] }),
      200,
    );
    expect(linked.counts.products).toBe(2);
    expect((await ok(send('put', path, 'director', { productIds: [] }), 200)).products).toEqual([]);
  });
});

describe('FR-032 documents', () => {
  it('lists, relabels and unlinks documents while keeping the file row', async () => {
    const campaign = await createCampaign();
    const base = '/campaigns/' + campaign.id + '/documents';
    const document = await ok(
      send('post', base).field('label', 'Mécanisme').attach('file', PDF, 'm.pdf'),
      201,
    );
    expect(document.uploadedBy).toEqual({
      id: people.director.id,
      fullName: people.director.fullName,
    });
    const listed = await ok(send('get', base, 'general'), 200);
    expect(listed.map(({ id }) => id)).toEqual([document.id]);
    const renamed = await ok(
      send('patch', base + '/' + document.id, 'director', { label: 'Mécanisme v2' }),
      200,
    );
    expect(renamed.label).toBe('Mécanisme v2');
    await ok(send('delete', base + '/' + document.id), 204);
    expect(await ok(send('get', base), 200)).toEqual([]);
    expect(await prisma.file.count({ where: { id: document.fileId } })).toBe(1);
    await rejected(send('delete', base + '/' + document.id), 404, 'NOT_FOUND');
    await rejected(
      send('post', base, 'general').field('label', 'x').attach('file', PDF, 'm.pdf'),
      403,
      'FORBIDDEN',
    );
  });
});

it('refuses every edit of a closed campaign (the status matrix has its own tests)', async () => {
  const campaign = await createCampaign();
  await ok(setWilayas(campaign.id, [{ wilayaId: 16, requiredAnimateurs: 1 }]), 200);
  const staff = await ok(addStaff(campaign.id, people.supervisor, 16), 201);
  const document = await ok(
    send('post', '/campaigns/' + campaign.id + '/documents')
      .field('label', 'Doc')
      .attach('file', PDF, 'm.pdf'),
    201,
  );
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'closed' } });
  const base = '/campaigns/' + campaign.id;
  const attempts = [
    send('patch', base, 'director', { version: 1, name: 'No' }),
    setWilayas(campaign.id, []),
    addStaff(campaign.id, people.regional, 16),
    send('delete', base + '/staff/' + staff.id),
    send('put', base + '/points-of-sale', 'director', { pointOfSaleIds: [] }),
    send('put', base + '/products', 'director', { productIds: [] }),
    send('post', base + '/documents')
      .field('label', 'x')
      .attach('file', PDF, 'm.pdf'),
    send('patch', base + '/documents/' + document.id, 'director', { label: 'x' }),
    send('delete', base + '/documents/' + document.id),
  ];
  for (const attempt of attempts) {
    await rejected(attempt, 422, 'FIELD_NOT_EDITABLE_IN_STATUS');
  }
});

describe('scope', () => {
  let staffed;
  let unstaffed;

  beforeAll(async () => {
    staffed = await createCampaign({ name: 'Scope staffed' });
    unstaffed = await createCampaign({ name: 'Scope unstaffed', clientId: clientY.id });
    await ok(setWilayas(staffed.id, [{ wilayaId: 31, requiredAnimateurs: 2 }]), 200);
    await ok(addStaff(staffed.id, people.regional, 31), 201);
    await ok(addStaff(staffed.id, people.supervisor, 31), 201);
    await ok(
      send('put', '/campaigns/' + staffed.id + '/points-of-sale', 'director', {
        pointOfSaleIds: [points.c31.id],
      }),
      200,
    );
    await assignment(staffed.id, {
      pointOfSaleId: points.c31.id,
      startDate: day(future(100)),
      endDate: day(future(110)),
    });
  });

  const visibleIds = async (actor) =>
    (await ok(send('get', '/campaigns?q=Scope&pageSize=100', actor), 200)).map(({ id }) => id);

  it('shows each role only its campaigns', async () => {
    expect((await visibleIds('director')).sort()).toEqual([staffed.id, unstaffed.id].sort());
    expect((await visibleIds('general')).sort()).toEqual([staffed.id, unstaffed.id].sort());
    expect(await visibleIds('regional')).toEqual([staffed.id]);
    expect(await visibleIds('regionalTwo')).toEqual([]);
    expect(await visibleIds('supervisor')).toEqual([staffed.id]);
    expect(await visibleIds('supervisorTwo')).toEqual([]);
    expect(await visibleIds('animateur')).toEqual([staffed.id]);
    expect(await visibleIds('clientUser')).toEqual([staffed.id]);
    await rejected(send('get', '/campaigns/' + unstaffed.id, 'regional'), 404, 'NOT_FOUND');
    await rejected(send('get', '/campaigns/' + unstaffed.id, 'clientUser'), 404, 'NOT_FOUND');
    await rejected(
      send('get', '/campaigns/' + unstaffed.id + '/status-history', 'supervisor'),
      404,
      'NOT_FOUND',
    );
    await ok(send('get', '/campaigns/' + staffed.id + '/status-history', 'supervisor'), 200);
    await rejected(
      send('patch', '/campaigns/' + staffed.id, 'regional', { version: 1, name: 'x' }),
      403,
      'FORBIDDEN',
    );
  });

  it('hides the budget and internal coverage from client users', async () => {
    const [listed] = await ok(send('get', '/campaigns?q=Scope', 'clientUser'), 200);
    const detail = await ok(send('get', '/campaigns/' + staffed.id, 'clientUser'), 200);
    for (const campaign of [listed, detail]) {
      expect(Object.keys(campaign).sort()).toEqual(
        ['client', 'code', 'description', 'endDate', 'id', 'name', 'startDate', 'status'].sort(),
      );
      expect(JSON.stringify(campaign)).not.toContain('2500000');
    }
  });

  it('filters by status, client, wilaya and period', async () => {
    const ids = async (query) =>
      (await ok(send('get', '/campaigns?q=Scope&' + query), 200)).map(({ id }) => id);
    expect(await ids('clientId=' + clientY.id)).toEqual([unstaffed.id]);
    expect(await ids('wilayaId=31')).toEqual([staffed.id]);
    expect(await ids('status=active')).toEqual([]);
    expect((await ids('from=' + future(15) + '&to=' + future(20))).length).toBe(2);
    expect(await ids('to=' + future(5))).toEqual([]);
    await rejected(
      send('get', '/campaigns?from=2027-02-10&to=2027-01-01'),
      400,
      'VALIDATION_FAILED',
    );
  });
});

it('seeds two demo draft campaigns idempotently', async () => {
  const demoAgency = await createAgency();
  await createUser(demoAgency.id, { role: 'director' });
  const opts = {
    agency: demoAgency,
    environment: { NODE_ENV: 'test', DEMO_PASSWORD: 'Demo-Password-2026' },
  };
  await seedDemo(opts);
  await seedDemo(opts);
  const campaigns = await prisma.campaign.findMany({
    where: { agencyId: demoAgency.id },
    include: { _count: { select: { wilayas: true, pointsOfSale: true, products: true } } },
    orderBy: { name: 'asc' },
  });
  expect(campaigns.map((row) => [row.name, row.status])).toEqual([
    ['Demo campaign 1', 'draft'],
    ['Demo campaign 2', 'draft'],
  ]);
  for (const campaign of campaigns) {
    expect(campaign._count).toMatchObject({ wilayas: 2, products: 4 });
    expect(campaign._count.pointsOfSale).toBeGreaterThan(0);
    expect(await prisma.campaignStaff.count({ where: { campaignId: campaign.id } })).toBe(4);
    expect(await prisma.stockLocation.count({ where: { campaignId: campaign.id } })).toBe(5);
  }
});
