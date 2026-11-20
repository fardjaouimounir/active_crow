import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app.js';
import { prisma } from '../../../db/client.js';
import {
  createCampaign,
  createPointOfSale,
  createRuleSet,
  createUser,
  day,
  linkPointOfSale,
} from '../../../db/__tests__/factories.js';
import { createWorld, offsetDate } from '../../campaigns/__tests__/fixtures.js';
import { canApproveAssignment } from '../assignments.policies.js';

let world;
beforeAll(async () => {
  world = await createWorld(createApp());
});

async function setup({
  status = 'assigned',
  supervisor = 'supervisor',
  regional = 'regional',
} = {}) {
  const { agency, client, people } = world;
  const campaign = await createCampaign(agency.id, client.id, {
    status,
    startDate: day(offsetDate(0)),
    endDate: day(offsetDate(25)),
  });
  const point = await createPointOfSale(agency.id, { wilayaId: 16 });
  await prisma.campaignWilaya.create({
    data: { campaignId: campaign.id, agencyId: agency.id, wilayaId: 16, requiredAnimateurs: 3 },
  });
  await prisma.campaignStaff.createMany({
    data: [
      {
        campaignId: campaign.id,
        agencyId: agency.id,
        wilayaId: 16,
        userId: people[supervisor].id,
        role: 'supervisor',
      },
      {
        campaignId: campaign.id,
        agencyId: agency.id,
        wilayaId: 16,
        userId: people[regional].id,
        role: 'regional_manager',
      },
    ],
  });
  await linkPointOfSale(campaign, point.id);
  return { campaign, point, path: '/campaigns/' + campaign.id };
}

async function member(supervisor = 'supervisor') {
  const user = await createUser(world.agency.id, { role: 'animateur' });
  await prisma.reportingLine.create({
    data: {
      agencyId: world.agency.id,
      userId: user.id,
      managerId: world.people[supervisor].id,
      validFrom: day(offsetDate(-10)),
    },
  });
  return user;
}

const input = (point, user, patch = {}) => ({
  animateurId: user.id,
  pointOfSaleId: point.id,
  startDate: offsetDate(1),
  endDate: offsetDate(8),
  ...patch,
});
const action = (row, name) => '/assignments/' + row.id + '/' + name;

describe('assignment workflows', () => {
  it('FR-051: proposes, approves, counts staffing by date and hides rows from clients', async () => {
    const { send, rejected, ok, people } = world;
    const { campaign, path, point } = await setup();
    const user = await member();
    const proposal = await ok(
      send('post', path + '/assignments', 'supervisor', input(point, user)),
      201,
    );
    expect(proposal).toMatchObject({ status: 'proposed', supervisorId: people.supervisor.id });
    expect(await ok(send('get', '/assignments/pending', 'regional'))).toContainEqual(
      expect.objectContaining({ id: proposal.id }),
    );
    await rejected(send('post', action(proposal, 'reject'), 'regional', {}), 422, 'NOTE_REQUIRED');
    await rejected(send('post', action(proposal, 'approve'), 'regionalTwo'), 404, 'NOT_FOUND');
    await rejected(send('post', action(proposal, 'approve'), 'supervisor'), 403, 'FORBIDDEN');
    await ok(send('post', action(proposal, 'approve'), 'regional'));
    expect(await ok(send('get', path + '/staffing?date=' + offsetDate(1), 'regional'))).toEqual([
      expect.objectContaining({
        approvedAnimateurs: 1,
        proposedCount: 0,
        requiredAnimateurs: 3,
        uncoveredPointsOfSale: [],
      }),
    ]);
    expect(await ok(send('get', path + '/assignments', 'supervisor'))).toHaveLength(1);
    await rejected(send('get', path + '/assignments', 'clientUser'), 404, 'NOT_FOUND');
    await createRuleSet(campaign, { status: 'approved', effectiveFrom: new Date() });
    await ok(send('post', path + '/activate', 'director'));
  });

  it('BR-13: rejects concurrent proposals and redacts out-of-scope conflicts at inclusive boundaries', async () => {
    const { send, rejected, ok, people } = world;
    const first = await setup({ supervisor: 'supervisorTwo', regional: 'regionalTwo' });
    const second = await setup();
    const user = await member();
    const original = await ok(
      send(
        'post',
        first.path + '/assignments',
        'director',
        input(first.point, user, { supervisorId: people.supervisorTwo.id }),
      ),
      201,
    );
    const body = input(second.point, user, { startDate: offsetDate(8), endDate: offsetDate(9) });
    const { conflict } = await rejected(
      send('post', second.path + '/assignments', 'supervisor', body),
      409,
      'ASSIGNMENT_OVERLAP',
    );
    expect(conflict).toEqual({
      label: 'another assignment',
      startDate: offsetDate(1),
      endDate: offsetDate(8),
    });
    const candidates = await ok(
      send(
        'get',
        second.path +
          '/assignment-candidates?wilayaId=16&from=' +
          offsetDate(8) +
          '&to=' +
          offsetDate(9),
        'supervisor',
      ),
    );
    expect(candidates.find(({ id }) => id === user.id)).toMatchObject({
      available: false,
      conflict,
    });
    await ok(send('post', action(original, 'cancel'), 'director'));
    const outcomes = await Promise.all([
      send('post', second.path + '/assignments', 'supervisor', body),
      send('post', second.path + '/assignments', 'supervisor', body),
    ]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual([201, 409]);
    expect(outcomes.find(({ status }) => status === 409).body.error.code).toBe(
      'ASSIGNMENT_OVERLAP',
    );
  });

  it('reports batch indexes, applies no partial writes, and ends a leaving Animateur’s assignments', async () => {
    const { send, rejected, ok } = world;
    const { path, point } = await setup();
    const user = await member();
    const body = input(point, user);
    const details = await rejected(
      send('post', path + '/assignments/batch', 'supervisor', [
        body,
        { ...body, workDays: [1, 1] },
      ]),
      422,
      'WORK_DAYS_INVALID',
    );
    expect(details.items).toEqual([{ index: 1, code: 'WORK_DAYS_INVALID' }]);
    expect(await ok(send('get', path + '/assignments'))).toHaveLength(0);
    const [row] = await ok(
      send('post', path + '/assignments/batch', 'supervisor', [
        { ...body, startDate: offsetDate(0) },
      ]),
      201,
    );
    await ok(
      send('post', '/assignments/decisions', 'regional', [{ id: row.id, decision: 'approve' }]),
    );
    const future = await ok(
      send('post', path + '/assignments', 'supervisor', {
        ...body,
        startDate: offsetDate(9),
        endDate: offsetDate(10),
      }),
      201,
    );
    await ok(send('post', '/users/' + user.id + '/suspend'));
    expect((await prisma.assignment.findUnique({ where: { id: future.id } })).status).toBe(
      'proposed',
    );
    await ok(send('post', '/users/' + user.id + '/mark-left'));
    expect(await prisma.assignment.findUnique({ where: { id: row.id } })).toMatchObject({
      status: 'approved',
      endDate: day(offsetDate(0)),
    });
    expect((await prisma.assignment.findUnique({ where: { id: future.id } })).status).toBe(
      'cancelled',
    );
  });

  it('FR-054: holds history through rejection and shortens only when the replacement is approved', async () => {
    const { send, ok, rejected } = world;
    const { campaign, path, point } = await setup();
    const first = await member();
    const next = await member();
    const original = await ok(
      send('post', path + '/assignments', 'supervisor', input(point, first)),
      201,
    );
    await ok(send('post', action(original, 'approve'), 'regional'));
    await rejected(
      send('post', action(original, 'cancel'), 'supervisor'),
      403,
      'NOT_ASSIGNMENT_APPROVER',
    );
    const replacement = { animateurId: next.id, fromDate: offsetDate(3), reason: 'Cover the shop' };
    const proposed = await ok(
      send('post', action(original, 'replace'), 'supervisor', replacement),
      201,
    );
    await ok(send('post', action(proposed, 'reject'), 'regional', { note: 'Not confirmed' }));
    expect((await prisma.assignment.findUnique({ where: { id: original.id } })).endDate).toEqual(
      day(offsetDate(8)),
    );
    const row = await ok(send('post', action(original, 'replace'), 'supervisor', replacement), 201);
    await ok(send('post', action(row, 'approve'), 'regional'));
    expect(await ok(send('get', path + '/assignments'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: original.id, endDate: offsetDate(2) }),
        expect.objectContaining({
          id: row.id,
          startDate: offsetDate(3),
          status: 'approved',
          replacesAssignmentId: original.id,
        }),
      ]),
    );
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'suspended' } });
    await rejected(
      send('post', path + '/assignments', 'supervisor', input(point, first)),
      422,
      'CAMPAIGN_NOT_ACCEPTING_ASSIGNMENTS',
    );
    await ok(
      send('post', action(row, 'end'), 'regional', {
        endDate: offsetDate(5),
        reason: 'Store closed',
      }),
    );
  });
});

describe('Q-09 approval matrix', () => {
  const claims = [
    { role: 'director' },
    { role: 'general_manager' },
    { role: 'regional_manager', id: 'local' },
    { role: 'regional_manager', id: 'elsewhere' },
    { role: 'supervisor' },
  ];
  it.each([
    ['director', [true, false, false, false, false]],
    ['general_manager', [true, true, false, false, false]],
    ['regional_manager', [true, true, true, false, false]],
  ])('limits the %s configuration to eligible staff', (assignmentApproverRole, expected) => {
    const campaign = {
      assignmentApproverRole,
      wilayas: [{ wilayaId: 16, staff: [{ userId: 'local', role: 'regional_manager' }] }],
    };
    expect(claims.map((actor) => canApproveAssignment(actor, campaign, 16))).toEqual(expected);
  });
});

it('validates proposal business rules before any write', async () => {
  const { send, rejected, people } = world;
  const { path, point } = await setup();
  const user = await member();
  const other = await member('supervisorTwo');
  const base = input(point, user, { supervisorId: people.supervisor.id });
  const cases = [
    [{ pointOfSaleId: world.client.id }, 'POS_NOT_IN_CAMPAIGN'],
    [{ supervisorId: people.supervisorTwo.id }, 'SUPERVISOR_NOT_ON_WILAYA_STAFF'],
    [{ animateurId: people.supervisor.id }, 'NOT_AN_ANIMATEUR'],
    [{ startDate: offsetDate(-1) }, 'START_DATE_IN_PAST'],
    [{ endDate: offsetDate(26) }, 'DATES_OUTSIDE_CAMPAIGN'],
    [{ endDate: offsetDate(0) }, 'DATES_OUTSIDE_CAMPAIGN'],
    [{ workDays: [] }, 'WORK_DAYS_INVALID'],
    [{ workDays: [8] }, 'WORK_DAYS_INVALID'],
    [{ shiftStart: '09:00' }, 'SHIFT_INVALID'],
    [{ shiftStart: '10:00', shiftEnd: '09:00' }, 'SHIFT_INVALID'],
  ];
  for (const [patch, code] of cases) {
    await rejected(
      send('post', path + '/assignments', 'director', { ...base, ...patch }),
      422,
      code,
    );
  }
  await rejected(
    send('post', path + '/assignments', 'supervisor', input(point, other)),
    404,
    'NOT_FOUND',
  );
  await rejected(
    send('post', path + '/assignments', 'supervisor', {
      ...base,
      supervisorId: people.supervisorTwo.id,
    }),
    422,
    'SUPERVISOR_NOT_ON_WILAYA_STAFF',
  );
  await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });
  await rejected(send('post', path + '/assignments', 'director', base), 422, 'USER_INACTIVE');
  const malformed = await rejected(
    send('post', path + '/assignments/batch', 'director', [base, { ...base, unexpected: true }]),
    400,
    'VALIDATION_FAILED',
  );
  expect(malformed.items).toMatchObject([{ index: 1, code: 'VALIDATION_FAILED' }]);
});

it('returns an Animateur’s own approved assignment and replaces a future assignment atomically', async () => {
  const { send, rejected, ok, people } = world;
  const { path, point } = await setup();
  const employee = people.animateur;
  const body = input(point, employee, {
    supervisorId: people.supervisor.id,
    shiftStart: '09:00',
    shiftEnd: '12:00',
    workDays: [1, 2, 3],
  });
  const original = await ok(send('post', path + '/assignments', 'director', body), 201);
  expect(await ok(send('get', '/me/assignments', 'animateur'))).toEqual([]);
  await ok(send('post', action(original, 'approve'), 'director'));
  expect(await ok(send('get', '/me/assignments', 'animateur'))).toEqual([
    expect.objectContaining({
      id: original.id,
      shiftStart: '09:00',
      shiftEnd: '12:00',
      workDays: [1, 2, 3],
      campaign: expect.objectContaining({ id: original.campaignId }),
      supervisor: expect.objectContaining({ phone: null }),
    }),
  ]);
  await rejected(
    send('post', action(original, 'replace'), 'director', {
      animateurId: employee.id,
      fromDate: offsetDate(1),
      reason: 'Same person',
    }),
    422,
    'REPLACEMENT_DATE_INVALID',
  );
  const offDay = Array.from({ length: 8 }, (_, index) => offsetDate(index + 1)).find(
    (day) => ![1, 2, 3].includes(new Date(day).getUTCDay()),
  );
  expect(await ok(send('get', path + '/staffing?date=' + offDay))).toEqual([
    expect.objectContaining({
      approvedAnimateurs: 0,
      uncoveredPointsOfSale: [expect.objectContaining({ id: point.id })],
    }),
  ]);
  const next = await member();
  const replacement = await ok(
    send('post', action(original, 'replace'), 'general', {
      animateurId: next.id,
      fromDate: offsetDate(1),
      reason: 'Replacement before start',
    }),
    201,
  );
  expect(replacement).toMatchObject({
    status: 'approved',
    replacesAssignmentId: original.id,
    workDays: [1, 2, 3],
  });
  expect((await prisma.assignment.findUnique({ where: { id: original.id } })).status).toBe(
    'cancelled',
  );
  expect(await ok(send('get', '/me/assignments', 'animateur'))).toEqual([]);
});
