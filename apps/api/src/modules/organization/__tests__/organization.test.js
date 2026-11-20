import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadReferenceData } from '../../../../prisma/seed/index.js';
import { seedDemo } from '../../../../prisma/seed/demo.js';
import { createApp } from '../../../app.js';
import { businessDate } from '../../../core/time/clock.js';
import {
  createAgency,
  createCampaign,
  createClient,
  createStockItem,
  createUser,
  day,
  ensureWilaya,
  linkPointOfSale,
} from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { bearer, createUserWithPassword, login } from '../../../../test/helpers/auth.js';

const app = createApp();
const root = '/api/v1';
const auth = {};
const people = {};
let agency;
let outsider;
let commune;
let otherCommune;

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

const offsetDate = (offset) => {
  const at = day(businessDate());
  at.setUTCDate(at.getUTCDate() + offset);
  return at.toISOString().slice(0, 10);
};

async function report(user, manager, offset = -2) {
  return prisma.reportingLine.create({
    data: {
      agencyId: agency.id,
      userId: user.id,
      managerId: manager.id,
      validFrom: day(offsetDate(offset)),
    },
  });
}

async function employee(name, manager = people.supervisor, offset = -2) {
  const user = await createUser(agency.id, { role: 'animateur', fullName: name });
  await report(user, manager, offset);
  return user;
}

beforeAll(async () => {
  await Promise.all([9, 16, 22, 27, 31, 35].map(ensureWilaya));
  agency = await createAgency();
  const otherAgency = await createAgency();
  outsider = await createUser(otherAgency.id, { role: 'supervisor' });
  for (const [name, role] of Object.entries({
    director: 'director',
    directorTwo: 'director',
    regional: 'regional_manager',
    supervisor: 'supervisor',
    next: 'supervisor',
    animateur: 'animateur',
  })) {
    const user = await createUserWithPassword(agency.id, { role });
    people[name] = user;
    auth[name] = bearer((await login(app, user)).accessToken);
  }
  await report(people.regional, people.director);
  await report(people.supervisor, people.regional);
  await report(people.next, people.regional);
  await report(people.animateur, people.supervisor);
  const { communes } = loadReferenceData();
  [commune, otherCommune] = await Promise.all(
    [16, 31].map((wilayaId) => {
      const row = communes.find((item) => item.wilayaId === wilayaId);
      return prisma.commune.upsert({ where: { code: row.code }, update: {}, create: row });
    }),
  );
});

describe('reference and dated organization', () => {
  it('serves authenticated references with private caching and validates wilaya identifiers', async () => {
    const wilayas = await send('get', '/reference/wilayas', 'animateur');
    expect(wilayas.status).toBe(200);
    expect(wilayas.headers['cache-control']).toBe('private, max-age=86400');
    expect(wilayas.body.data).toContainEqual(expect.objectContaining({ id: 16 }));
    expect(
      await ok(send('get', '/reference/wilayas/16/communes', 'supervisor'), 200),
    ).toContainEqual(expect.objectContaining({ id: commune.id }));
    await rejected(send('get', '/reference/wilayas/bad/communes'), 400, 'VALIDATION_FAILED');
    await rejected(send('get', '/reference/wilayas/999/communes'), 404, 'NOT_FOUND');
    await rejected(send('get', '/reference/wilayas', null), 401, 'UNAUTHENTICATED');
  });

  it('FR-012 returns a dated regional subtree and lists only visible users', async () => {
    const [regional] = await ok(
      send('get', '/organization/tree?at=' + offsetDate(-1), 'regional'),
      200,
    );
    expect(regional).toMatchObject({ id: people.regional.id, managerId: null });
    expect(regional.children.map(({ id }) => id)).toEqual(
      expect.arrayContaining([people.supervisor.id, people.next.id]),
    );
    const response = await send('get', '/users?role=animateur&page=1&pageSize=1', 'supervisor');
    expect(response.body).toMatchObject({
      data: [{ id: people.animateur.id }],
      meta: { total: 1 },
    });
    await rejected(send('get', '/users/' + outsider.id, 'regional'), 404, 'NOT_FOUND');
    await rejected(
      send('get', '/users/' + people.next.id + '/reporting-lines', 'supervisor'),
      404,
      'NOT_FOUND',
    );
    await rejected(send('get', '/organization/tree?at=2026-02-30'), 400, 'VALIDATION_FAILED');
    await rejected(send('get', '/organization/tree', 'animateur'), 403, 'FORBIDDEN');
    await rejected(send('get', '/users?pageSize=101'), 400, 'VALIDATION_FAILED');
  });
});

describe('user management', () => {
  it('creates, edits and returns one password, keeps secrets out of reads and audit logs', async () => {
    const body = {
      role: 'animateur',
      managerId: people.supervisor.id,
      fullName: 'Recruit',
      email: 'Recruit@example.dz',
      phone: '0555123456',
      wilayaId: 16,
      communeId: commune.id,
      profile: { experienceYears: 2, skills: ['sampling'], languages: ['ar', 'fr'] },
    };
    const { user, temporaryPassword } = await ok(send('post', '/users', 'director', body), 201);
    expect(user).toMatchObject({
      mustChangePassword: true,
      phone: '+213555123456',
      email: 'recruit@example.dz',
    });
    expect(temporaryPassword).toHaveLength(16);
    const details = await ok(send('get', '/users/' + user.id), 200);
    expect(details.currentManager.id).toBe(people.supervisor.id);
    expect(details.profile.skills).toEqual(['sampling']);
    expect(JSON.stringify(details)).not.toMatch(/passwordHash|temporaryPassword/);
    const signedIn = await login(app, { email: user.email, password: temporaryPassword });
    const gate = await request(app)
      .get(root + '/reference/wilayas')
      .set(bearer(signedIn.accessToken));
    expect(gate.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await rejected(send('post', '/users', 'director', body), 409, 'EMAIL_TAKEN');
    await rejected(send('post', '/users', 'supervisor', body), 403, 'FORBIDDEN');
    await rejected(
      send('post', '/users', 'director', { ...body, role: 'client', email: 'client@example.dz' }),
      422,
      'ROLE_NOT_CREATABLE',
    );
    await rejected(
      send('patch', '/users/' + user.id, 'director', { role: 'director' }),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(
      send('patch', '/users/' + user.id, 'director', { communeId: otherCommune.id }),
      422,
      'COMMUNE_NOT_IN_WILAYA',
    );
    await ok(send('patch', '/users/' + user.id, 'director', { fullName: 'Renamed' }), 200);
    const reset = await ok(send('post', '/users/' + user.id + '/reset-password'), 200);
    expect(reset.temporaryPassword).not.toBe(temporaryPassword);
    const audit = await prisma.auditLog.findMany({
      where: { entityId: user.id },
      select: { before: true, after: true },
    });
    expect(JSON.stringify(audit)).not.toMatch(
      new RegExp(temporaryPassword + '|' + reset.temporaryPassword + '|passwordHash'),
    );
  });

  it('enforces the role matrix, active managers and agency isolation', async () => {
    const team = {
      animateur: ['supervisor'],
      supervisor: ['regional_manager'],
      regional_manager: ['general_manager', 'director'],
      general_manager: ['director'],
    };
    const managers = {};
    for (const role of [
      'director',
      'general_manager',
      'regional_manager',
      'supervisor',
      'animateur',
    ]) {
      managers[role] = await createUser(agency.id, { role });
    }
    for (const [role, allowed] of Object.entries(team)) {
      for (const [managerRole, manager] of Object.entries(managers)) {
        const req = send('post', '/users', 'director', {
          role,
          fullName: 'Matrix member',
          email: randomUUID() + '@example.dz',
          managerId: manager.id,
        });
        if (allowed.includes(managerRole)) await ok(req, 201);
        else await rejected(req, 422, 'INVALID_MANAGER_ROLE');
      }
    }
    await rejected(
      send('post', '/users', 'director', {
        role: 'animateur',
        fullName: 'Out of scope',
        email: 'outside@example.dz',
        managerId: outsider.id,
      }),
      404,
      'NOT_FOUND',
    );
  });

  it('BR-03 status actions revoke existing sessions and preserve same-day history', async () => {
    const member = await createUserWithPassword(agency.id, { role: 'animateur' });
    await report(member, people.supervisor, 0);
    const token1 = bearer((await login(app, member)).accessToken);
    await ok(send('post', '/users/' + member.id + '/suspend'), 200);
    expect(
      (
        await request(app)
          .get(root + '/auth/me')
          .set(token1)
      ).status,
    ).toBe(401);
    await ok(send('post', '/users/' + member.id + '/reactivate'), 200);
    const token2 = bearer((await login(app, member)).accessToken);
    await ok(send('post', '/users/' + member.id + '/mark-left'), 200);
    expect(
      (
        await request(app)
          .get(root + '/auth/me')
          .set(token2)
      ).status,
    ).toBe(401);
    const [line] = await ok(send('get', '/users/' + member.id + '/reporting-lines'), 200);
    expect(line.validTo).toBe(line.validFrom);
    await rejected(
      send('post', '/users/' + people.director.id + '/suspend'),
      422,
      'CANNOT_CHANGE_OWN_STATUS',
    );
  });
});

it('BR-03 protects the last active director', async () => {
  const loneAgency = await createAgency();
  const director = await createUserWithPassword(loneAgency.id, { role: 'director' });
  auth.lone = bearer((await login(app, director)).accessToken);
  await rejected(
    send('post', '/users/' + director.id + '/mark-left', 'lone'),
    422,
    'LAST_ACTIVE_DIRECTOR',
  );
});

describe('transfers', () => {
  it('keeps an empty historical interval when a new employee moves on their first day', async () => {
    const member = await employee('Same-day transfer', people.supervisor, 0);
    await ok(
      send('post', '/users/' + member.id + '/transfers', 'director', {
        newManagerId: people.next.id,
        effectiveDate: offsetDate(0),
        reason: 'Same-day move',
      }),
      201,
    );
    const { currentManager, reportingLines } = await ok(send('get', '/users/' + member.id), 200);
    expect(currentManager.id).toBe(people.next.id);
    const previous = reportingLines.find(({ managerId }) => managerId === people.supervisor.id);
    expect(previous.validFrom).toBe(previous.validTo);
  });

  it('BR-02 preserves yesterday’s manager, validates dates and limits writes to the subtree', async () => {
    const member = await employee('Transfer today');
    const path = '/users/' + member.id + '/transfers';
    const payload = {
      newManagerId: people.next.id,
      effectiveDate: offsetDate(0),
      reason: 'Team change',
    };
    await rejected(send('post', path, 'supervisor', payload), 403, 'FORBIDDEN');
    await rejected(
      send('post', path, 'regional', { ...payload, newManagerId: outsider.id }),
      404,
      'NOT_FOUND',
    );
    await rejected(
      send('post', path, 'director', { ...payload, newManagerId: member.id }),
      422,
      'MANAGER_CYCLE',
    );
    await rejected(
      send('post', path, 'director', { ...payload, effectiveDate: offsetDate(-1) }),
      422,
      'TRANSFER_DATE_INVALID',
    );
    await ok(send('post', path, 'regional', payload), 201);
    const [oldSupervisor] = await ok(
      send('get', '/organization/tree?at=' + offsetDate(-1), 'supervisor'),
      200,
    );
    expect(oldSupervisor.children).toContainEqual(expect.objectContaining({ id: member.id }));
    const [newSupervisor] = await ok(
      send('get', '/organization/tree?at=' + offsetDate(0), 'next'),
      200,
    );
    expect(newSupervisor.children).toContainEqual(expect.objectContaining({ id: member.id }));
    await rejected(send('get', '/users/' + member.id, 'supervisor'), 404, 'NOT_FOUND');
  });

  it('schedules and cancels future transfers and serializes concurrent moves', async () => {
    const member = await employee('Schedule transfer');
    const path = '/users/' + member.id + '/transfers';
    const payload = {
      newManagerId: people.next.id,
      effectiveDate: offsetDate(4),
      reason: 'Schedule',
    };
    await ok(send('post', path, 'director', payload), 201);
    await rejected(send('post', path, 'director', payload), 409, 'TRANSFER_ALREADY_SCHEDULED');
    await ok(send('delete', path + '/scheduled'), 204);
    expect(await ok(send('get', '/users/' + member.id + '/reporting-lines'), 200)).toHaveLength(1);
    const results = await Promise.all([
      send('post', path, 'director', payload),
      send('post', path, 'director', payload),
    ]);
    expect(results.map(({ status }) => status).sort()).toEqual([201, 409]);
  });

  it('BR-04 / E-01 / E-05 vetoes an entire team transfer if one member holds stock', async () => {
    const manager = await createUser(agency.id, { role: 'supervisor' });
    await report(manager, people.regional);
    const first = await employee('First member', manager);
    const holder = await employee('Stock holder', manager);
    const client = await createClient(agency.id);
    const campaign = await createCampaign(agency.id, client.id);
    const stock = await createStockItem(agency.id, client.id);
    const location = await prisma.stockLocation.create({
      data: {
        agencyId: agency.id,
        campaignId: campaign.id,
        kind: 'holder',
        userId: holder.id,
      },
    });
    await prisma.stockBalance.create({
      data: {
        agencyId: agency.id,
        locationId: location.id,
        locationKind: 'holder',
        stockItemId: stock.id,
        quantity: 2,
      },
    });
    const body = {
      newManagerId: people.next.id,
      effectiveDate: offsetDate(0),
      reason: 'Reassign team',
    };
    const result = await rejected(
      send('post', '/users/' + manager.id + '/transfers/team', 'director', body),
      422,
      'HOLDER_HAS_STOCK',
    );
    expect(result.campaigns).toEqual([campaign.code]);
    const detail = await ok(send('get', '/users/' + first.id), 200);
    expect(detail.currentManager.id).toBe(manager.id);
    expect(detail.reportingLines).toHaveLength(1);
  });
});

describe('regions and points of sale', () => {
  it('FR-011 replaces wilayas atomically and prevents deleting a populated region', async () => {
    const first = await ok(
      send('post', '/regions', 'director', { code: 'FIRST', name: 'First region' }),
      201,
    );
    const second = await ok(
      send('post', '/regions', 'director', { code: 'SECOND', name: 'Second region' }),
      201,
    );
    await ok(send('patch', '/regions/' + first.id, 'director', { name: 'Updated region' }), 200);
    await ok(
      send('put', '/regions/' + first.id + '/wilayas', 'director', { wilayaIds: [16] }),
      200,
    );
    await rejected(
      send('put', '/regions/' + second.id + '/wilayas', 'director', { wilayaIds: [16] }),
      409,
      'WILAYA_ALREADY_IN_REGION',
    );
    await rejected(send('delete', '/regions/' + first.id), 422, 'REGION_NOT_EMPTY');
    await rejected(
      send('post', '/regions', 'supervisor', { code: 'BAD', name: 'Forbidden' }),
      403,
      'FORBIDDEN',
    );
    await ok(send('get', '/regions', 'regional'), 200);
    await ok(send('put', '/regions/' + first.id + '/wilayas', 'director', { wilayaIds: [] }), 200);
    await ok(send('delete', '/regions/' + first.id), 204);
  });

  it('FR-014 validates geography, agency scope, version and campaign links', async () => {
    const body = {
      name: 'Market',
      code: 'P01',
      type: 'retail',
      wilayaId: 16,
      communeId: commune.id,
    };
    const point = await ok(send('post', '/points-of-sale', 'director', body), 201);
    await rejected(send('post', '/points-of-sale', 'director', body), 409, 'POS_CODE_TAKEN');
    await rejected(
      send('post', '/points-of-sale', 'director', {
        ...body,
        code: 'P02',
        communeId: otherCommune.id,
      }),
      422,
      'COMMUNE_NOT_IN_WILAYA',
    );
    await rejected(
      send('post', '/points-of-sale', 'director', { ...body, latitude: 35 }),
      400,
      'VALIDATION_FAILED',
    );
    await rejected(
      send('patch', '/points-of-sale/' + point.id, 'supervisor', { version: 1, name: 'Forbidden' }),
      403,
      'FORBIDDEN',
    );
    const patched = await ok(
      send('patch', '/points-of-sale/' + point.id, 'director', {
        version: point.version,
        latitude: 35,
        longitude: 2,
        name: 'New name',
      }),
      200,
    );
    expect(patched.version).toBe(point.version + 1);
    await rejected(
      send('patch', '/points-of-sale/' + point.id, 'director', {
        version: point.version,
        name: 'Stale',
      }),
      409,
      'VERSION_CONFLICT',
    );
    await ok(send('get', '/points-of-sale/' + point.id, 'regional'), 200);
    const client = await createClient(agency.id);
    const campaign = await createCampaign(agency.id, client.id);
    await linkPointOfSale(campaign, point.id);
    await rejected(send('delete', '/points-of-sale/' + point.id), 422, 'POS_IN_ACTIVE_CAMPAIGN');
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'cancelled' } });
    await ok(send('delete', '/points-of-sale/' + point.id), 204);
    await rejected(send('get', '/points-of-sale/' + point.id), 404, 'NOT_FOUND');
    await ok(send('get', '/points-of-sale?wilayaId=16&type=retail'), 200);
  });
});

it('seeds exactly the requested demo organization twice and refuses production', async () => {
  const demoAgency = await createAgency();
  await createUser(demoAgency.id, { role: 'director' });
  const opts = {
    agency: demoAgency,
    environment: { NODE_ENV: 'test', DEMO_PASSWORD: 'Demo-Password-2026' },
  };
  await seedDemo(opts);
  await seedDemo(opts);
  const where = { agencyId: demoAgency.id, isDemo: true };
  expect(await prisma.user.count({ where })).toBe(19);
  expect(await prisma.region.count({ where })).toBe(2);
  expect(await prisma.pointOfSale.count({ where })).toBe(20);
  expect(await prisma.reportingLine.count({ where: { agencyId: demoAgency.id } })).toBe(19);
  await expect(
    seedDemo({ ...opts, environment: { ...opts.environment, NODE_ENV: 'production' } }),
  ).rejects.toThrow(/production/);
});
