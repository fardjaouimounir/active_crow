import { today } from '@fieldflow/shared';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app.js';
import { SYSTEM_SCOPE } from '../../../core/authz/index.js';
import { events } from '../../../core/events/index.js';
import { jobs } from '../../../core/jobs/index.js';
import { databaseUrl, prisma } from '../../../db/client.js';
import { createCustomer } from '../../../db/__tests__/factories.js';
import { withTransaction } from '../../../db/transaction.js';
import { bearer, login } from '../../../../test/helpers/auth.js';
import { createWorld, offsetDate } from '../../campaigns/__tests__/fixtures.js';
import { anonymizeCustomers } from '../../customers/anonymization.js';
import { notificationService } from '../notifications.service.js';
import { deliver } from '../subscriptions.js';

let world;
let fixture;
beforeAll(async () => {
  world = await createWorld(createApp());
  fixture = await world.readyCampaign({ status: 'active' });
});
const noticeWhere = (type) => ({ agencyId: world.agency.id, type });

describe('post-commit events and jobs', () => {
  it('drops a rolled-back event and delivers a committed event once even when another handler throws', async () => {
    const seen = vi.fn();
    const off = events.on('campaign.status_changed', seen);
    const offBroken = events.on('campaign.status_changed', () => {
      throw new Error('fixture subscriber error');
    });
    const payload = {
      agencyId: world.agency.id,
      actorId: world.people.director.id,
      campaignId: fixture.campaign.id,
      status: 'active',
    };
    try {
      await expect(
        withTransaction(async (tx) => {
          events.emit(tx, 'campaign.status_changed', payload);
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      await withTransaction(async (tx) => {
        events.emit(tx, 'campaign.status_changed', payload);
        expect(seen).not.toHaveBeenCalled();
      });
      await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    } finally {
      off();
      offBroken();
    }
  });

  it('enqueues and runs a job on the PostgreSQL test database with system scope', async () => {
    const name = 'integration-' + randomUUID();
    const calls = vi.fn();
    jobs.register(name, (data, { scope }) => calls(data, scope));
    try {
      await jobs.start(databaseUrl);
      await jobs.enqueue(name, { test: true });
      await vi.waitFor(() => expect(calls).toHaveBeenCalledWith({ test: true }, SYSTEM_SCOPE), {
        timeout: 10000,
      });
    } finally {
      await jobs.stop();
    }
  }, 20000);

  it('anonymizes customers in a campaign closed more than six months ago and audits the count once', async () => {
    const older = await world.readyCampaign({ status: 'closed' });
    const newer = await world.readyCampaign({ status: 'closed' });
    const monthsAgo = (months) => {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() - months);
      return d;
    };
    for (const [item, when] of [
      [older, monthsAgo(7)],
      [newer, monthsAgo(5)],
    ]) {
      await prisma.campaignStatusHistory.create({
        data: {
          campaignId: item.campaign.id,
          agencyId: world.agency.id,
          toStatus: 'closed',
          createdAt: when,
        },
      });
    }
    const customer = (item) =>
      createCustomer(
        { agency: world.agency, campaign: item.campaign, animateur: item.animateur },
        { fullName: 'Synthetic customer', phone: '+213555014001' },
      );
    const old = await customer(older);
    const recent = await customer(newer);
    await anonymizeCustomers({}, { scope: SYSTEM_SCOPE });
    await anonymizeCustomers({}, { scope: SYSTEM_SCOPE });
    expect(await prisma.customer.findUnique({ where: { id: old.id } })).toMatchObject({
      fullName: null,
      phone: null,
      anonymizedAt: expect.any(Date),
    });
    expect(await prisma.customer.findUnique({ where: { id: recent.id } })).toMatchObject({
      fullName: 'Synthetic customer',
      anonymizedAt: null,
    });
    const logs = await prisma.auditLog.findMany({
      where: {
        agencyId: world.agency.id,
        action: 'customers.anonymized',
        entityId: older.campaign.id,
      },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0].after).toEqual({ count: 1 });
  }, 15000);

  it('deduplicates notification replay across concurrent deliveries', async () => {
    const id = randomUUID();
    const event = {
      id,
      name: 'campaign.status_changed',
      payload: {
        agencyId: world.agency.id,
        actorId: world.people.director.id,
        campaignId: fixture.campaign.id,
        status: 'active',
      },
    };
    await Promise.all([deliver(event), deliver(event)]);
    const notices = await prisma.notification.findMany({
      where: { ...noticeWhere(event.name), payload: { path: ['eventId'], equals: id } },
    });
    expect(notices).toHaveLength(3);
    expect(notices.map(({ userId }) => userId)).not.toContain(world.people.director.id);
  });
});

describe('communications API', () => {
  it('reports a point-of-sale issue, attaches to a comment and enforces visibility and optimistic status changes', async () => {
    const { send, ok, rejected } = world;
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    const req = send('post', '/issues', 'supervisor')
      .field('campaignId', fixture.campaign.id)
      .field('pointOfSaleId', fixture.pointOfSale.id)
      .field('title', 'Out of gifts')
      .field('category', 'stock_shortage')
      .attach('files', image, 'photo.png');
    const issue = await ok(req, 201);
    const path = '/issues/' + issue.id;
    expect(issue.attachments).toHaveLength(1);
    await rejected(send('get', path, 'regionalTwo'), 404, 'NOT_FOUND');
    await rejected(send('get', path, 'clientUser'), 404, 'NOT_FOUND');
    await vi.waitFor(async () =>
      expect(
        await prisma.notification.count({
          where: {
            ...noticeWhere('issue.created'),
            entityId: issue.id,
            userId: world.people.regional.id,
          },
        }),
      ).toBe(1),
    );
    const comment = await ok(
      send('post', path + '/comments', 'regional')
        .field('body', 'Please investigate')
        .attach('files', image, 'photo.png'),
      201,
    );
    const [attachment] = comment.attachments;
    expect((await ok(send('get', path, 'regional'))).attachments).toHaveLength(1);
    expect((await send('get', '/files/' + attachment.fileId, 'regional')).status).toBe(200);
    await rejected(send('get', '/files/' + attachment.fileId, 'regionalTwo'), 404, 'NOT_FOUND');
    const started = await ok(
      send('post', path + '/start', 'supervisor', { version: issue.version }),
    );
    await rejected(
      send('post', path + '/resolve', 'supervisor', { version: issue.version }),
      409,
      'VERSION_CONFLICT',
    );
    await rejected(
      send('post', path + '/resolve', 'supervisor', { version: started.version }),
      422,
      'RESOLUTION_NOTE_REQUIRED',
    );
    const solved = await ok(
      send('post', path + '/resolve', 'supervisor', {
        version: started.version,
        resolutionNote: 'Store received supplies',
      }),
    );
    expect(solved.status).toBe('resolved');
    expect(
      (await ok(send('post', path + '/reopen', 'supervisor', { version: solved.version }))).status,
    ).toBe('open');
  });

  it('previews the audience, publishes, records reads and protects notification ownership', async () => {
    const { ok, send, rejected } = world;
    const { count } = await ok(
      send(
        'get',
        '/announcements/audience-preview?targetRoles=supervisor&campaignId=' +
          fixture.campaign.id +
          '&wilayaId=16',
      ),
    );
    expect(count).toBe(1);
    await rejected(
      send('get', '/announcements/audience-preview?targetRoles=general_manager', 'supervisor'),
      422,
      'AUDIENCE_NOT_ALLOWED',
    );
    const row = await ok(
      send('post', '/announcements', 'director', {
        title: 'Demo notice',
        body: 'A plain text announcement',
        campaignId: fixture.campaign.id,
        wilayaId: 16,
        targetRoles: ['supervisor'],
      }),
      201,
    );
    expect(row.audienceCount).toBe(count);
    const path = '/announcements/' + row.id;
    const items = await ok(send('get', '/announcements', 'supervisor'));
    expect(items).toContainEqual(expect.objectContaining({ id: row.id, readAt: null }));
    await rejected(send('get', path, 'supervisorTwo'), 404, 'NOT_FOUND');
    expect((await ok(send('get', path + '/reads'))).notRead).toHaveLength(1);
    await ok(send('get', path, 'supervisor'));
    expect((await ok(send('get', path + '/reads'))).read).toHaveLength(1);
    const notices = await ok(send('get', '/notifications?unread=true', 'supervisor'));
    const notice = notices.find(({ entityId }) => entityId === row.id);
    expect(notice).toBeDefined();
    await rejected(
      send('post', '/notifications/' + notice.id + '/read', 'supervisorTwo'),
      404,
      'NOT_FOUND',
    );
    await ok(send('post', '/notifications/read-all', 'supervisor'));
    expect(await ok(send('get', '/notifications/unread-count', 'supervisor'))).toEqual({
      count: 0,
    });
  });
});

it('notifies the configured approvers and the Animateur through assignment actions', async () => {
  const { send, ok } = world;
  await prisma.campaign.update({
    where: { id: fixture.campaign.id },
    data: { endDate: new Date(offsetDate(45)) },
  });
  const existing = await prisma.assignment.findFirstOrThrow({
    where: { campaignId: fixture.campaign.id },
  });
  await prisma.reportingLine.create({
    data: {
      agencyId: world.agency.id,
      userId: fixture.animateur.id,
      managerId: world.people.supervisor.id,
      validFrom: existing.startDate,
    },
  });
  const row = await ok(
    send('post', '/campaigns/' + fixture.campaign.id + '/assignments', 'supervisor', {
      animateurId: fixture.animateur.id,
      pointOfSaleId: fixture.pointOfSale.id,
      startDate: offsetDate(40),
      endDate: offsetDate(41),
    }),
    201,
  );
  await vi.waitFor(async () => {
    const items = await prisma.notification.findMany({
      where: { ...noticeWhere('assignment.proposed'), entityId: row.id },
    });
    expect(items.map(({ userId }) => userId).sort()).toEqual(
      [world.people.director.id, world.people.general.id, world.people.regional.id].sort(),
    );
  });
  await ok(send('post', '/assignments/' + row.id + '/approve', 'regional'));
  await vi.waitFor(async () => {
    const items = await prisma.notification.findMany({
      where: { ...noticeWhere('assignment.approved'), entityId: row.id },
    });
    expect(items.map(({ userId }) => userId).sort()).toEqual(
      [world.people.supervisor.id, fixture.animateur.id].sort(),
    );
  });
});

it('keeps recent notifications when the maintenance job deletes old ones', async () => {
  const userId = world.people.supervisor.id;
  const make = (createdAt) =>
    prisma.notification.create({
      data: { agencyId: world.agency.id, userId, type: 'fixture', createdAt },
    });
  const stale = await make(new Date(Date.now() - 91 * 86400000));
  const recent = await make(new Date(Date.now() - 89 * 86400000));
  await notificationService.cleanup();
  expect(await prisma.notification.findUnique({ where: { id: stale.id } })).toBeNull();
  expect(await prisma.notification.findUnique({ where: { id: recent.id } })).not.toBeNull();
});

it('retains old announcement notifications and keeps the announcement in the recipient feed', async () => {
  const { ok, send } = world;
  const announcement = await ok(
    send('post', '/announcements', 'director', {
      title: 'Retained announcement',
      body: 'Still available after ninety days.',
      campaignId: fixture.campaign.id,
      wilayaId: 16,
      targetRoles: ['supervisor'],
    }),
    201,
  );
  const where = {
    agencyId: world.agency.id,
    type: 'announcement.published',
    entityId: announcement.id,
    userId: world.people.supervisor.id,
  };
  const olderThanNinetyDays = new Date(Date.now() - 91 * 86400000);
  expect(
    (await prisma.notification.updateMany({ where, data: { createdAt: olderThanNinetyDays } }))
      .count,
  ).toBe(1);
  await prisma.announcement.update({
    where: { id: announcement.id },
    data: { publishedAt: olderThanNinetyDays },
  });
  await notificationService.cleanup();
  expect(await prisma.notification.findFirst({ where })).toMatchObject({
    createdAt: olderThanNinetyDays,
  });
  expect(await ok(send('get', '/announcements', 'supervisor'))).toContainEqual(
    expect.objectContaining({ id: announcement.id }),
  );
});

it('only allows an Animateur to report at the assigned point of sale on a scheduled work day', async () => {
  const { send, ok, rejected } = world;
  const access = await login(world.app, fixture.animateur);
  world.auth.scheduled = bearer(access.accessToken);
  const assignment = await prisma.assignment.findFirstOrThrow({
    where: {
      campaignId: fixture.campaign.id,
      animateurId: fixture.animateur.id,
      startDate: { lte: new Date(today()) },
    },
  });
  const weekday = new Date(today()).getUTCDay() || 7;
  const updateDays = (days) =>
    prisma.assignment.update({ where: { id: assignment.id }, data: { workDays: days } });
  const body = {
    campaignId: fixture.campaign.id,
    pointOfSaleId: fixture.pointOfSale.id,
    category: 'other',
    title: 'Workday access check',
  };
  try {
    await updateDays([weekday === 7 ? 1 : weekday + 1]);
    await rejected(send('post', '/issues', 'scheduled', body), 422, 'NOT_ASSIGNED_HERE');
    await updateDays([weekday]);
    await ok(send('post', '/issues', 'scheduled', body), 201);
  } finally {
    await updateDays(assignment.workDays);
  }
});

it('shows each Animateur only their own assignment identifier in a replacement notification', async () => {
  const original = await prisma.assignment.findFirstOrThrow({
    where: {
      campaignId: fixture.campaign.id,
      animateurId: fixture.animateur.id,
      startDate: { lte: new Date(today()) },
    },
  });
  const replacement = await prisma.assignment.create({
    data: {
      agencyId: original.agencyId,
      campaignId: original.campaignId,
      pointOfSaleId: original.pointOfSaleId,
      animateurId: world.people.animateur.id,
      supervisorId: original.supervisorId,
      proposedById: original.proposedById,
      startDate: original.startDate,
      endDate: original.endDate,
      replacesAssignmentId: original.id,
      status: 'approved',
    },
  });
  const event = {
    id: randomUUID(),
    name: 'assignment.replaced',
    payload: {
      agencyId: world.agency.id,
      actorId: world.people.director.id,
      assignmentId: replacement.id,
    },
  };
  await deliver(event);
  await deliver(event);
  const notices = await prisma.notification.findMany({
    where: { ...noticeWhere(event.name), payload: { path: ['eventId'], equals: event.id } },
    select: { userId: true, entityId: true },
  });
  expect(notices).toHaveLength(3);
  expect(notices).toContainEqual({ userId: original.animateurId, entityId: original.id });
  expect(notices).toContainEqual({ userId: replacement.animateurId, entityId: replacement.id });
});

it('revokes a regional reporter’s issue and attachment access when their wilaya staffing is removed', async () => {
  const { ok, send, rejected } = world;
  const { campaign, pointOfSale } = await world.readyCampaign({ status: 'active' });
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
    .png()
    .toBuffer();
  const stock = await world.gift();
  const description = '備'.repeat(1500) + 'م'.repeat(500);
  const req = send('post', '/issues', 'regional')
    .field('campaignId', campaign.id)
    .field('pointOfSaleId', pointOfSale.id)
    .field('category', 'other')
    .field('title', 'Staffing visibility check')
    .field('stockItemId', stock.id)
    .field('description', description)
    .attach('files', image, 'photo-1.png')
    .attach('files', image, 'photo-2.png')
    .attach('files', image, 'photo-3.png');
  const issue = await ok(req, 201);
  expect(issue.description).toBe(description);
  expect(issue.attachments).toHaveLength(3);
  await prisma.campaignStaff.deleteMany({
    where: { campaignId: campaign.id, userId: world.people.regional.id },
  });
  await rejected(send('get', '/issues/' + issue.id, 'regional'), 404, 'NOT_FOUND');
  await rejected(
    send('get', '/files/' + issue.attachments[0].fileId, 'regional'),
    404,
    'NOT_FOUND',
  );
  await rejected(
    send('post', '/issues/' + issue.id + '/start', 'regional', { version: issue.version }),
    404,
    'NOT_FOUND',
  );
  await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'closed' } });
  await rejected(
    send('post', '/issues/' + issue.id + '/start', 'director', { version: issue.version }),
    422,
    'CAMPAIGN_NOT_ACCEPTING_ISSUES',
  );
  await rejected(
    send('post', '/issues/' + issue.id + '/comments', 'director', { body: 'Late comment' }),
    422,
    'CAMPAIGN_NOT_ACCEPTING_ISSUES',
  );
});
