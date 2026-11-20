import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bearer, login } from '../../../../test/helpers/auth.js';
import { createApp } from '../../../app.js';
import { clock } from '../../../core/time/clock.js';
import {
  createAssignment,
  createCampaign,
  createPointOfSale,
  createRuleSet,
  createUser,
  day,
  linkPointOfSale,
} from '../../../db/__tests__/factories.js';
import { prisma } from '../../../db/client.js';
import { attendanceRule, createWorld } from '../../campaigns/__tests__/fixtures.js';
import { issueService } from '../../issues/issues.service.js';
import { autoVerify, review } from '../attendance.service.js';

const date = '2026-11-20';
const instant = new Date(date + 'T07:45:00Z');
let world;
let photo;
beforeAll(async () => {
  photo = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'green' } })
    .jpeg()
    .withMetadata()
    .toBuffer();
});
beforeEach(async () => {
  vi.spyOn(clock, 'now').mockReturnValue(instant);
  world = await createWorld(createApp());
});
afterEach(() => vi.restoreAllMocks());

async function setup(rule = {}) {
  const { agency, client, people } = world;
  const campaign = await createCampaign(agency.id, client.id);
  const pointOfSale = await createPointOfSale(agency.id, { latitude: 36.75, longitude: 3.04 });
  await linkPointOfSale(campaign, pointOfSale.id);
  const version = await createRuleSet(campaign, {
    status: 'approved',
    effectiveFrom: day('2026-11-01'),
  });
  await prisma.campaignRule.create({
    data: {
      agencyId: agency.id,
      ruleSetId: version.id,
      ruleType: 'attendance',
      config: { ...attendanceRule, ...rule },
    },
  });
  const assignment = await createAssignment(
    { agency, campaign, pointOfSale, ...people, manager: people.regional },
    { startDate: day(date), endDate: day('2026-11-25') },
  );
  return {
    campaign,
    pointOfSale,
    version,
    assignment,
    path: '/campaigns/' + campaign.id,
    assignmentPath: '/assignments/' + assignment.id,
  };
}

const idempotent = (request, key = randomUUID()) => request.set('Idempotency-Key', key);
const checkpoint = (context, key, patch = {}) => {
  const request = idempotent(
    world.send('post', context.assignmentPath + '/attendance', 'animateur'),
    key,
  ).field('checkpoint', 'morning');
  for (const [name, value] of Object.entries(patch)) request.field(name, value);
  return request.attach('photo', photo, 'proof.jpg');
};
const absence = (context) =>
  idempotent(
    world.send('post', context.assignmentPath + '/absences', 'supervisor', {
      workDate: date,
      type: 'justified',
      reason: 'Medical appointment',
    }),
  );

describe('attendance, absences and visits', () => {
  it('BR-20, BR-22, BR-23: records at server time, stores the rule version, and replays the proof', async () => {
    const context = await setup();
    const board = context.path + '/attendance/board?date=' + date;
    expect(
      (await world.ok(world.send('get', board, 'supervisor'))).rows[0].checkpoints[0].status,
    ).toBe('not_sent');
    const key = randomUUID();
    const record = await world.ok(checkpoint(context, key), 201);
    expect(record).toMatchObject({
      status: 'pending',
      recordedAt: instant.toISOString(),
      workDate: date,
      ruleSetId: context.version.id,
      isLate: false,
    });
    const replay = await checkpoint(context, key);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.data.id).toBe(record.id);
    await world.rejected(checkpoint(context), 409, 'CHECKPOINT_ALREADY_RECORDED');
    await world.rejected(absence(context), 409, 'ABSENCE_CONFLICTS_ATTENDANCE');
    await world.rejected(world.send('get', board, 'clientUser'), 404, 'NOT_FOUND');
    const photoUrl = '/files/' + record.photoFileId;
    await world.rejected(world.send('get', photoUrl, 'clientUser'), 404, 'NOT_FOUND');
    await world.rejected(world.send('get', photoUrl, 'supervisorTwo'), 404, 'NOT_FOUND');
    const saved = await world.send('get', photoUrl, 'supervisor');
    expect(saved.status).toBe(200);
    expect((await sharp(saved.body).metadata()).exif).toBeUndefined();
    await world.rejected(
      world.send('post', '/attendance/' + record.id + '/verify', 'supervisorTwo', {}),
      404,
      'NOT_FOUND',
    );
    await expect(
      review(
        {
          type: 'user',
          agencyId: world.agency.id,
          id: world.people.animateur.id,
          role: 'director',
        },
        record.id,
        'verified',
      ),
    ).rejects.toMatchObject({ code: 'NOT_ATTENDANCE_REVIEWER' });
    await world.ok(world.send('post', '/attendance/' + record.id + '/verify', 'supervisor', {}));
    await world.rejected(
      world.send('post', '/attendance/' + record.id + '/verify', 'supervisor', {}),
      409,
      'ATTENDANCE_NOT_PENDING',
    );
    await world.ok(
      world.send('post', '/attendance/' + record.id + '/override', 'director', {
        status: 'rejected',
        note: 'Incorrect proof',
      }),
    );
    const detail = await world.ok(world.send('get', '/attendance/' + record.id, 'supervisor'));
    expect(detail.reviewHistory.map(({ action }) => action)).toEqual([
      'attendance.reviewed',
      'attendance.overridden',
    ]);
    await vi.waitFor(async () => {
      expect(
        await prisma.notification.count({
          where: {
            agencyId: world.agency.id,
            userId: world.people.animateur.id,
            type: 'attendance.rejected',
            entityId: record.id,
          },
        }),
      ).toBe(1);
    });
  });

  it('FR-063: a voided absence permits another absence and a later proof', async () => {
    const context = await setup();
    const first = await world.ok(absence(context), 201);
    await world.rejected(absence(context), 409, 'ABSENCE_ALREADY_RECORDED');
    const voidIt = (id) =>
      world.send('post', '/absences/' + id + '/void', 'director', { reason: 'Wrong absence' });
    expect(await world.ok(voidIt(first.id))).toMatchObject({
      voidReason: 'Wrong absence',
      voidedById: world.people.director.id,
    });
    await world.rejected(voidIt(first.id), 409, 'ABSENCE_ALREADY_VOIDED');
    const second = await world.ok(absence(context), 201);
    await world.ok(voidIt(second.id));
    const record = await world.ok(checkpoint(context), 201);
    const detail = await world.ok(world.send('get', '/attendance/' + record.id, 'director'));
    expect(detail.absences.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(detail.absences.every(({ voidedAt }) => Boolean(voidedAt))).toBe(true);
  });

  it('E-12: a proof far from the point of sale stays pending after auto-verify', async () => {
    const context = await setup({ autoVerifyAfterHours: 1, maxDistanceMeters: 300 });
    const record = await world.ok(
      checkpoint(context, undefined, { latitude: '36.77', longitude: '3.04', gpsAccuracyM: '12' }),
      201,
    );
    expect(record.flags).toContain('far_from_pos');
    clock.now.mockReturnValue(new Date(+instant + 3_600_001));
    await autoVerify();
    expect((await prisma.attendanceRecord.findUnique({ where: { id: record.id } })).status).toBe(
      'pending',
    );
  });

  it('FR-064: stores a visit with two photos and a linked issue', async () => {
    const context = await setup();
    const visit = idempotent(world.send('post', context.path + '/visits', 'supervisor'))
      .field('pointOfSaleId', context.pointOfSale.id)
      .field('observedAnimateurIds', JSON.stringify([world.people.animateur.id]))
      .field('issues', JSON.stringify([{ category: 'stock_shortage', title: 'No display stock' }]))
      .attach('photos', photo, 'one.jpg')
      .attach('photos', photo, 'two.jpg');
    const result = await world.ok(visit, 201);
    expect(result.photos).toHaveLength(2);
    expect(result.issues[0].visitId).toBe(result.id);
    const detail = await world.ok(world.send('get', '/visits/' + result.id, 'supervisor'));
    expect(detail.observedAnimateurs[0].id).toBe(world.people.animateur.id);
    await world.rejected(world.send('get', '/visits/' + result.id, 'clientUser'), 404, 'NOT_FOUND');
  });

  it('BR-11 and BR-22: checks opening time, required evidence and the inclusive tolerance boundary', async () => {
    const context = await setup({
      checkpoints: [{ ...attendanceRule.checkpoints[0], gps: true }],
      maxDistanceMeters: 300,
    });
    clock.now.mockReturnValue(new Date(date + 'T07:29:00Z'));
    await world.rejected(checkpoint(context), 422, 'CHECKPOINT_NOT_OPEN');
    clock.now.mockReturnValue(new Date(date + 'T07:30:00Z'));
    await world.rejected(
      idempotent(world.send('post', context.assignmentPath + '/attendance', 'animateur')).field(
        'checkpoint',
        'morning',
      ),
      422,
      'PHOTO_REQUIRED',
    );
    await world.rejected(checkpoint(context), 422, 'GPS_REQUIRED');
    clock.now.mockReturnValue(instant);
    const proof = await world.ok(
      checkpoint(context, undefined, { latitude: 36.75, longitude: 3.04, gpsAccuracyM: 350 }),
      201,
    );
    expect(proof.flags).toEqual(['low_gps_accuracy']);
    expect(proof.isLate).toBe(false);
  });

  it('keeps a proof from a removed checkpoint and uses the new rule for subsequent proofs', async () => {
    const context = await setup();
    const original = await world.ok(checkpoint(context), 201);
    clock.now.mockReturnValue(new Date(date + 'T12:50:00Z'));
    for (const role of ['animateur', 'supervisor']) {
      world.auth[role] = bearer((await login(world.app, world.people[role])).accessToken);
    }
    await prisma.ruleSet.update({
      where: { id: context.version.id },
      data: { status: 'superseded' },
    });
    const version = await createRuleSet(context.campaign, {
      status: 'approved',
      effectiveFrom: new Date(date + 'T12:45:00Z'),
    });
    await prisma.campaignRule.create({
      data: {
        agencyId: world.agency.id,
        ruleSetId: version.id,
        ruleType: 'attendance',
        config: {
          ...attendanceRule,
          checkpoints: [
            { ...attendanceRule.checkpoints[0], code: 'after_break', window: ['13:30', '14:15'] },
          ],
        },
      },
    });
    await prisma.assignment.update({
      where: { id: context.assignment.id },
      data: { endDate: day(date) },
    });
    const late = await world.ok(
      idempotent(world.send('post', context.assignmentPath + '/attendance', 'animateur'))
        .field('checkpoint', 'after_break')
        .attach('photo', photo, 'proof.jpg'),
      201,
    );
    expect(late).toMatchObject({ ruleSetId: version.id, isLate: true });
    const board = await world.ok(
      world.send('get', context.path + '/attendance/board?date=' + date, 'supervisor'),
    );
    expect(board.rows[0].checkpoints.map(({ record }) => record.id)).toEqual([
      late.id,
      original.id,
    ]);
    const bulk = await world.ok(
      world.send('post', context.path + '/attendance/verify-bulk', 'supervisor', {
        ids: [original.id, randomUUID(), late.id],
      }),
    );
    expect(bulk.verified).toEqual([original.id, late.id]);
    expect(bulk.skipped[0].code).toBe('NOT_FOUND');
  });

  it('uses the regional reporting line on the work date for historical board and review', async () => {
    const context = await setup();
    const { supervisor, regional, regionalTwo } = world.people;
    await prisma.reportingLine.createMany({
      data: [
        {
          agencyId: world.agency.id,
          userId: supervisor.id,
          managerId: regional.id,
          validFrom: day('2026-11-01'),
          validTo: day('2026-11-21'),
        },
        {
          agencyId: world.agency.id,
          userId: supervisor.id,
          managerId: regionalTwo.id,
          validFrom: day('2026-11-21'),
        },
      ],
    });
    const proof = await world.ok(checkpoint(context), 201);
    const board = context.path + '/attendance/board?date=' + date;
    await world.rejected(world.send('get', board, 'regionalTwo'), 404, 'NOT_FOUND');
    await world.rejected(
      world.send('post', '/attendance/' + proof.id + '/verify', 'regionalTwo', {}),
      404,
      'NOT_FOUND',
    );
    expect((await world.ok(world.send('get', board, 'regional'))).rows).toHaveLength(1);
    await world.ok(world.send('post', '/attendance/' + proof.id + '/verify', 'regional', {}));
  });

  it('FR-064: rejects an out-of-scope point, invalid observed IDs and malformed photos atomically', async () => {
    const context = await setup();
    const request = (actor, observed = []) =>
      idempotent(world.send('post', context.path + '/visits', actor))
        .field('pointOfSaleId', context.pointOfSale.id)
        .field('observedAnimateurIds', JSON.stringify(observed))
        .field(
          'issues',
          JSON.stringify([{ category: 'stock_shortage', title: 'No display stock' }]),
        )
        .attach('photos', photo, 'proof.jpg');
    await world.rejected(request('supervisorTwo'), 404, 'NOT_FOUND');
    await world.rejected(request('supervisor', [randomUUID()]), 422, 'INVALID_OBSERVED');
    await world.rejected(
      request('supervisor').attach('photos', Buffer.from('not an image'), 'bad.jpg'),
      422,
      'FILE_TYPE_NOT_ALLOWED',
    );
    expect(await prisma.supervisorVisit.count({ where: { campaignId: context.campaign.id } })).toBe(
      0,
    );
    expect(await prisma.issue.count({ where: { campaignId: context.campaign.id } })).toBe(0);
    expect(await prisma.file.count({ where: { agencyId: world.agency.id } })).toBe(0);
  });

  it('FR-064: rolls back the first linked issue and visit if the second issue cannot be written', async () => {
    const context = await setup();
    const create = issueService.createInTransaction;
    vi.spyOn(issueService, 'createInTransaction')
      .mockImplementationOnce(create)
      .mockRejectedValueOnce(new Error('forced issue creation failure'));
    const request = idempotent(world.send('post', context.path + '/visits', 'supervisor'))
      .field('pointOfSaleId', context.pointOfSale.id)
      .field(
        'issues',
        JSON.stringify([
          { category: 'stock_shortage', title: 'No display stock' },
          { category: 'equipment', title: 'Missing equipment' },
        ]),
      )
      .attach('photos', photo, 'proof.jpg');
    await world.rejected(request, 500, 'INTERNAL_ERROR');
    expect(await prisma.supervisorVisit.count({ where: { campaignId: context.campaign.id } })).toBe(
      0,
    );
    expect(await prisma.issue.count({ where: { campaignId: context.campaign.id } })).toBe(0);
    expect(await prisma.file.count({ where: { agencyId: world.agency.id } })).toBe(0);
  });

  it('computes scheduled days, validates future absence replacements and omits a suspended day', async () => {
    const context = await setup();
    const { agency, people } = world;
    await prisma.assignment.update({
      where: { id: context.assignment.id },
      data: { workDays: [6] },
    });
    await world.rejected(checkpoint(context), 422, 'FIELD_ENTRY_NOT_ALLOWED');
    const getBoard = (day) =>
      world.ok(world.send('get', context.path + '/attendance/board?date=' + day, 'supervisor'));
    expect((await getBoard(date)).rows).toEqual([]);
    const saturday = '2026-11-21';
    const future = (replacementAssignmentId) =>
      idempotent(
        world.send('post', context.assignmentPath + '/absences', 'supervisor', {
          workDate: saturday,
          type: 'unjustified',
          replacementAssignmentId,
        }),
      );
    await world.rejected(future(randomUUID()), 422, 'INVALID_REPLACEMENT');
    const replacementUser = await createUser(agency.id, { role: 'animateur' });
    const replacement = await createAssignment(
      {
        ...context,
        agency,
        animateur: replacementUser,
        supervisor: people.supervisor,
        manager: people.regional,
      },
      { startDate: day(saturday), endDate: day(saturday), workDays: [6] },
    );
    await world.ok(future(replacement.id), 201);
    expect((await getBoard(saturday)).counters).toMatchObject({
      absent_unjustified: 1,
      not_sent: 1,
    });
    await prisma.campaignStatusHistory.create({
      data: {
        agencyId: agency.id,
        campaignId: context.campaign.id,
        fromStatus: 'active',
        toStatus: 'suspended',
        createdAt: new Date(saturday + 'T06:00:00Z'),
      },
    });
    expect((await getBoard(saturday)).rows).toEqual([]);
  });
});
